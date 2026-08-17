import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'tool-rulebuddy'
export const inject = ['tools', 'webServer']

export interface Config { knowledgeDir: string }
export const Config: z<Config> = z.object({ knowledgeDir: z.string().required() })

interface GameInfo { id: string; name: string; nameZh: string; players: string; time: string; weight?: string; bggId?: string; image?: string; description: string }
interface RulebookSection { title: string; chapter: string; content: string }

function loadGameIndex(dir: string): GameInfo[] {
  const p = join(dir, 'game-index.json')
  if (!existsSync(p)) return []
  return JSON.parse(readFileSync(p, 'utf-8')).games || []
}

function loadRulebook(dir: string, gameId: string): string {
  const p = join(dir, gameId, 'rulebook.md')
  if (!existsSync(p)) return ''
  return readFileSync(p, 'utf-8')
}

function parseSections(text: string): RulebookSection[] {
  const lines = text.split('\n')
  const sections: RulebookSection[] = []
  let cur: RulebookSection | null = null
  let content: string[] = []
  for (const line of lines) {
    const h2 = line.match(/^## (.+)/); const h3 = line.match(/^### (.+)/)
    if (h2 || h3) {
      if (cur) { cur.content = content.join('\n').trim(); sections.push(cur) }
      const t = (h2 || h3)![1].trim()
      cur = { title: t, chapter: h2 ? t : (sections.length > 0 ? sections[sections.length - 1].title : ''), content: '' }
      content = []
    } else if (cur && line.trim()) { content.push(line) }
  }
  if (cur) { cur.content = content.join('\n').trim(); sections.push(cur) }
  return sections
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1)
}

function bm25Search(query: string, sections: RulebookSection[], topK = 5): RulebookSection[] {
  const qt = tokenize(query)
  return sections.map(s => {
    const tt = tokenize(s.title + ' ' + s.content); const tit = tokenize(s.title)
    let score = 0
    for (const q of qt) { score += tt.filter(t => t === q).length + tit.filter(t => t === q).length * 3 }
    return { section: s, score }
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, topK).map(s => s.section)
}

const GAME_HTML = "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <link rel=\"icon\" type=\"image/png\" href=\"/minilogo.png\" />\n  <title>RuleMeeple — 选择游戏</title>\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f5f0eb; color: #3d3226; min-height: 100vh; }\n    .header { text-align: center; padding: 48px 24px 32px; background: #fff; color: #3d3226; border-bottom: 1px solid #e8d5b7; }\n    .header img { width: 120px; height: 120px; margin-bottom: 16px; }\n    .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }\n    .header p { font-size: 16px; opacity: 0.6; }\n    .games { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 24px; padding: 40px 32px; max-width: 1200px; margin: 0 auto; }\n    .game-card { background: #fff; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); overflow: hidden; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; border: 2px solid transparent; }\n    .game-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.12); border-color: #4A90D9; }\n    .game-card-image { height: 180px; background: #f5f0eb; display: flex; align-items: center; justify-content: center; overflow: hidden; }\n    .game-card-image img { width: 100%; height: 100%; object-fit: cover; }\n    .game-card-image .placeholder { font-size: 64px; }\n    .game-card-body { padding: 20px; }\n    .game-card-body h2 { font-size: 20px; margin-bottom: 4px; color: #2c3e50; }\n    .game-card-body .zh { font-size: 16px; color: #7f8c8d; margin-bottom: 12px; }\n    .game-card-body .meta { display: flex; gap: 16px; font-size: 13px; color: #95a5a6; margin-bottom: 8px; }\n    .game-card-body .meta span { background: #f0f3f5; padding: 4px 10px; border-radius: 8px; }\n    .game-card-body .desc { font-size: 14px; color: #555; line-height: 1.5; }\n    .loading, .error { text-align: center; padding: 80px 24px; font-size: 18px; color: #95a5a6; }\n    .error { color: #e74c3c; }\n    @media (prefers-color-scheme: dark) { body { background: #1a1a2e; color: #e0d8c8; } .header { background: #2d2d3f; color: #e0d8c8; border-color: #3d3d50; } .game-card { background: #2d2d3f; } .game-card-body h2 { color: #e0d8c8; } .game-card-body .desc { color: #bbb; } .game-card-body .meta span { background: #3d3d50; } .game-card-image { background: #3d3d50; } }\n  </style>\n</head>\n<body>\n  <div class=\"header\"><img src=\"/rulemeeple.png\" alt=\"RuleMeeple\" /><h1>RuleMeeple</h1><p>选择一款桌游，开始学习规则</p></div>\n  <div id=\"games\" class=\"games\"><div class=\"loading\">加载游戏列表…</div></div>\n  <script>\n    async function load(){const c=document.getElementById('games');try{const r=await fetch('/api/games');const d=await r.json();if(!d.games||d.games.length===0){c.innerHTML='<div class=\"error\">暂无游戏</div>';return}c.innerHTML=d.games.map(g=>{const img='<img src=\"/cover/'+g.id+'\" alt=\"'+g.name+'\" onerror=\"this.parentElement.innerHTML=\\'<span class=placeholder>🎲</span>\\'\">';return'<div class=\"game-card\" onclick=\"s(\\''+g.id+'\\',\\''+g.name.replace(/'/g,\"\\\\'\")+'\\')\"><div class=\"game-card-image\">'+img+'</div><div class=\"game-card-body\"><h2>'+g.name+'</h2><div class=\"zh\">'+g.nameZh+'</div><div class=\"meta\"><span>👥 '+g.players+'</span><span>⏱ '+g.time+'</span><span>⚖️ '+(g.weight||'')+'</span></div><div class=\"desc\">'+g.description+'</div></div></div>'}).join('')}catch(e){c.innerHTML='<div class=\"error\">加载失败：'+e.message+'</div>'}}\n    function s(id,name){localStorage.setItem('rulemeeple_game',JSON.stringify({id,name}));window.location.href='/chat/?game='+encodeURIComponent(id)+'&name='+encodeURIComponent(name)}\n    load();\n  </script>\n</body>\n</html>";

export function apply(ctx: Context, config: Config): void {
  const dir = config.knowledgeDir

  ctx.webServer.register({
    kind: 'exact',
    path: '/',
    handler(_req, res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(GAME_HTML)
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/games',
    handler(_req, res) {
      const games = loadGameIndex(dir)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ games }))
    },
  })

  // ── Cover image cache proxy ──────────────────────────────────────
  const coverCache = new Map<string, Buffer>()
  ctx.webServer.register({
    kind: 'prefix',
    path: '/cover',
    async handler(req, res) {
      const url = req.url ?? ''
      const gameId = url.split('/cover/')[1]?.split('?')[0]
      if (!gameId) { res.writeHead(400); res.end(); return }
      const cached = coverCache.get(gameId)
      if (cached) { res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=86400'); res.end(cached); return }
      const games = loadGameIndex(dir)
      const game = games.find(g => g.id === gameId)
      if (!game?.image) { res.writeHead(404); res.end(); return }
      try {
        const fetchRes = await fetch(game.image, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'RuleMeeple/1.0', 'Referer': 'https://boardgamegeek.com/' } })
        if (!fetchRes.ok) { res.writeHead(502); res.end(); return }
        const buf = Buffer.from(await fetchRes.arrayBuffer())
        coverCache.set(gameId, buf)
        res.setHeader('Content-Type', fetchRes.headers.get('content-type') ?? 'image/jpeg')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.end(buf)
      } catch { res.writeHead(502); res.end() }
    },
  })

  ctx.tools.register(defineTool({
    name: 'list_games',
    description: 'List all available board games with their metadata.',
    parameters: {},
    output: { schema: { type: 'object', properties: { games: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, nameZh: { type: 'string' }, players: { type: 'string' }, time: { type: 'string' }, weight: { type: 'string' }, bggId: { type: 'string' }, image: { type: 'string' }, description: { type: 'string' } }, additionalProperties: false } } }, additionalProperties: false } },
    execute() { return Promise.resolve({ games: loadGameIndex(dir) }) },
    presentCall: () => ({ card: 'generic', title: 'List games', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'search_rulebook',
    description: 'Search the rulebook of a specific game. Returns the most relevant sections.',
    parameters: { gameId: { type: 'string', required: true, description: 'The game ID' }, query: { type: 'string', required: true, description: 'What rule information you need' } },
    output: { schema: { type: 'object', properties: { sections: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, chapter: { type: 'string' }, content: { type: 'string' } }, additionalProperties: false } } }, additionalProperties: false } },
    execute(args: any) {
      const rb = loadRulebook(dir, args.gameId)
      if (!rb) return Promise.resolve({ sections: [] })
      return Promise.resolve({ sections: bm25Search(args.query, parseSections(rb), 8).map(s => ({ title: s.title, chapter: s.chapter, content: s.content.slice(0, 1000) })) })
    },
    presentCall: (args: any) => ({ card: 'generic', title: 'Search rulebook', kind: 'other', rawInput: { gameId: args.gameId, query: args.query } }),
  }))

  ctx.tools.register(defineTool({
    name: 'get_section',
    description: 'Get the full content of a specific rulebook section by its exact title.',
    parameters: { gameId: { type: 'string', required: true, description: 'The game ID' }, sectionTitle: { type: 'string', required: true, description: 'The exact section title' } },
    output: { schema: { type: 'object', properties: { title: { type: 'string' }, chapter: { type: 'string' }, content: { type: 'string' } }, additionalProperties: false } },
    execute(args: any) {
      const rb = loadRulebook(dir, args.gameId)
      if (!rb) return Promise.resolve({ title: '', chapter: '', content: 'Rulebook not found.' })
      const secs = parseSections(rb)
      const found = secs.find((s: RulebookSection) => s.title.toLowerCase() === args.sectionTitle.toLowerCase())
      if (!found) return Promise.resolve({ title: args.sectionTitle, chapter: '', content: 'Not found. Available: ' + secs.map(s => s.title).join(', ') })
      return Promise.resolve({ title: found.title, chapter: found.chapter, content: found.content })
    },
    presentCall: (args: any) => ({ card: 'generic', title: 'Get section', kind: 'other', rawInput: { gameId: args.gameId, sectionTitle: args.sectionTitle } }),
  }))
}
