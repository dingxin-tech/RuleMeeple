// RuleMeeple brand wordmark: mini logo + "RuleMeeple" text.
// Native 120x24.

import type { IconProps } from './icons/props.ts'

export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={(size * 120) / 24}
      height={size}
      className={className}
      viewBox="0 0 120 24"
      fill="none"
      aria-hidden="true"
    >
      <image href="/minilogo.png" x="0" y="0" width="24" height="24" />
      <text x="28" y="17" fontFamily="system-ui, sans-serif" fontSize="14" fontWeight="600" fill="currentColor">
        RuleMeeple
      </text>
    </svg>
  )
}
