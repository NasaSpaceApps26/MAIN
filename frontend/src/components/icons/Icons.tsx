/**
 * Small inline SVG icons (instead of Unicode symbols, which some systems draw as emoji).
 * They take the text colour (currentColor) and scale with the font size (1em).
 */

type IconProps = { size?: string | number }

const svg = (size: string | number = '1em') => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: false,
  style: { display: 'inline-block', verticalAlign: '-0.125em' },
})

export function PlayIcon({ size }: IconProps) {
  return (
    <svg {...svg(size)}>
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  )
}

export function PauseIcon({ size }: IconProps) {
  return (
    <svg {...svg(size)}>
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" />
    </svg>
  )
}

/** Back to the start: a bar and a left-pointing triangle. */
export function RestartIcon({ size }: IconProps) {
  return (
    <svg {...svg(size)}>
      <rect x="2.5" y="2.5" width="2" height="11" rx="0.5" />
      <path d="M13 2.5v11L5.5 8z" />
    </svg>
  )
}

/** Half-lit Moon: the app's logo. */
export function MoonPhaseIcon({ size }: IconProps) {
  return (
    <svg {...svg(size)}>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" />
    </svg>
  )
}
