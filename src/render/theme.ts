/** Shared palette so the canvas and the CSS never drift apart. */

export const THEME = {
  paper: '#faf9f5',
  gridLine: '#e7e4db',
  gridLineStrong: '#dcd8cc',
  frameLine: '#a29d92',
  frameFill: '#ffffff',
  ink: '#15191c',
  muted: '#8b8578',
  /** X / Y / Z axis families. Desaturated enough to sit under the object ink. */
  axis: ['#b03f2c', '#2f7a58', '#33559c'] as const,
  shadeDark: { r: 0x3c, g: 0x43, b: 0x4a },
  shadeLight: { r: 0xe6, g: 0xe3, b: 0xd9 },
  /** The object's ink when the current vanishing points aren't orthogonal. */
  warn: '#a8621c',
} as const

export const MONO =
  '"SF Mono", ui-monospace, "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace'

/** Line weight, in CSS pixels, for each construction layer. */
export const WEIGHT = {
  grid: 1,
  frame: 1.25,
  convergence: 1,
  tangent: 1,
  altitude: 1,
  object: 1.7,
  hidden: 1.2,
} as const

export const ALPHA = {
  convergence: 0.34,
  tangent: 0.17,
  altitude: 0.26,
  triangle: 0.2,
  hidden: 0.28,
} as const

export function shadeColor(t: number): string {
  const a = THEME.shadeDark
  const b = THEME.shadeLight
  const m = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `rgb(${m(a.r, b.r)}, ${m(a.g, b.g)}, ${m(a.b, b.b)})`
}

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
