// RuleMeeple mini logo: the brand mark for collapsed sidebar.
// Native 24x24.

import type { IconProps } from './icons/props.ts'

export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <image href="/minilogo.png" x="0" y="0" width="24" height="24" />
    </svg>
  )
}
