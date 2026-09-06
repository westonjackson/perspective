/**
 * Canvas renderer. Redraws everything every frame — at this geometry count that
 * costs far less than tracking dirty regions would.
 *
 * Two coordinate systems:
 *   frame pixels  — where the camera, the picture plane and the vanishing points live
 *   screen pixels — the canvas, which pans and zooms independently
 */

import {
  type Camera,
  type Vec2,
  type VanishingPoint,
  add2,
  clipLineToRect,
  cross2,
  dist2,
  dot2,
  footOnLine,
  mul2,
  norm2,
  sub2,
  tangentIndicesFrom,
} from '../lib/perspective'
import type { Scene } from '../lib/scene'
import { ALPHA, MONO, THEME, WEIGHT, shadeColor, withAlpha } from './theme'

export interface Viewport {
  zoom: number
  /** Screen position of frame-space origin. */
  tx: number
  ty: number
}

export const toScreen = (v: Viewport, p: Vec2): Vec2 => ({
  x: p.x * v.zoom + v.tx,
  y: p.y * v.zoom + v.ty,
})

export const toFrame = (v: Viewport, p: Vec2): Vec2 => ({
  x: (p.x - v.tx) / v.zoom,
  y: (p.y - v.ty) / v.zoom,
})

export interface Toggles {
  convergence: boolean
  tangents: boolean
  grid: boolean
  groundGrid: boolean
  hiddenLines: boolean
  shaded: boolean
  altitudes: boolean
  labels: boolean
}

export interface DrawInput {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  view: Viewport
  camera: Camera
  scene: Scene
  frame: { w: number; h: number }
  ground: [Vec2, Vec2][]
  toggles: Toggles
  hoverHandle: number | null
  activeHandle: number | null
}

export const AXIS_LABELS = ['X', 'Y', 'Z'] as const
export const HANDLE_RADIUS = 9
export const HANDLE_HIT_RADIUS = 18

/** Inset from the canvas edge where handles for VPs at infinity are parked. */
const INFINITY_INSET = 46

// ---------------------------------------------------------------------------

export function draw(input: DrawInput): void {
  const { ctx, width, height, view, camera, scene, toggles } = input

  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = THEME.paper
  ctx.fillRect(0, 0, width, height)

  // Frame-space rectangle matching the visible canvas, used to clip guide lines
  // so we never hand the rasteriser coordinates in the millions.
  const tl = toFrame(view, { x: 0, y: 0 })
  const br = toFrame(view, { x: width, y: height })
  const clipRect = { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y }

  const S = (p: Vec2) => toScreen(view, p)
  const line = (a: Vec2, b: Vec2) => {
    const sa = S(a)
    const sb = S(b)
    ctx.beginPath()
    ctx.moveTo(sa.x, sa.y)
    ctx.lineTo(sb.x, sb.y)
    ctx.stroke()
  }
  /** Draw the infinite line through a and b, cropped to the viewport. */
  const infiniteLine = (a: Vec2, b: Vec2) => {
    const seg = clipLineToRect(a, b, clipRect)
    if (seg) line(seg[0], seg[1])
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const frameRect = {
    x: toScreen(view, { x: camera.p.x - input.frame.w / 2, y: camera.p.y - input.frame.h / 2 }).x,
    y: toScreen(view, { x: camera.p.x - input.frame.w / 2, y: camera.p.y - input.frame.h / 2 }).y,
    w: input.frame.w * view.zoom,
    h: input.frame.h * view.zoom,
  }

  if (toggles.grid) drawScreenGrid(ctx, width, height, view)
  drawImageFrame(ctx, frameRect)
  // The ground plane is scene content, not construction, so it belongs inside
  // the picture: clipping it there also keeps near-horizon lines from sprawling.
  if (toggles.groundGrid) drawGroundGrid(ctx, input.ground, S, frameRect)
  if (toggles.altitudes) drawConstraint(ctx, scene.vps, camera, S, infiniteLine)
  if (toggles.convergence) drawConvergence(ctx, scene, line, clipRect)
  if (toggles.tangents) drawTangents(ctx, scene, infiniteLine)
  drawObject(ctx, scene, S, line, toggles)
  drawHandles(ctx, scene.vps, camera, S, input)

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Layer 1 — background
// ---------------------------------------------------------------------------

function drawScreenGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: Viewport,
): void {
  // Choose a frame-space step that lands near 34 screen pixels, in a 1-2-5 series.
  const targetScreen = 34
  const raw = targetScreen / view.zoom
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const mantissa = raw / pow
  const step = pow * (mantissa < 1.5 ? 1 : mantissa < 3.5 ? 2 : mantissa < 7.5 ? 5 : 10)

  const tl = toFrame(view, { x: 0, y: 0 })
  const br = toFrame(view, { x: width, y: height })

  ctx.lineWidth = WEIGHT.grid
  for (const [axis, from, to] of [
    ['x', tl.x, br.x],
    ['y', tl.y, br.y],
  ] as const) {
    const start = Math.ceil(from / step) * step
    for (let t = start; t <= to; t += step) {
      const major = Math.abs(t / (step * 5) - Math.round(t / (step * 5))) < 1e-6
      ctx.strokeStyle = major ? THEME.gridLineStrong : THEME.gridLine
      const s = axis === 'x' ? t * view.zoom + view.tx : t * view.zoom + view.ty
      ctx.beginPath()
      if (axis === 'x') {
        ctx.moveTo(s, 0)
        ctx.lineTo(s, height)
      } else {
        ctx.moveTo(0, s)
        ctx.lineTo(width, s)
      }
      ctx.stroke()
    }
  }
}

function drawGroundGrid(
  ctx: CanvasRenderingContext2D,
  segments: [Vec2, Vec2][],
  S: (p: Vec2) => Vec2,
  frameRect: { x: number; y: number; w: number; h: number },
): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(frameRect.x, frameRect.y, frameRect.w, frameRect.h)
  ctx.clip()
  ctx.lineWidth = WEIGHT.grid
  ctx.strokeStyle = THEME.gridLineStrong
  ctx.beginPath()
  for (const [a, b] of segments) {
    const sa = S(a)
    const sb = S(b)
    ctx.moveTo(sa.x, sa.y)
    ctx.lineTo(sb.x, sb.y)
  }
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Layer 2 — the picture plane
// ---------------------------------------------------------------------------

function drawImageFrame(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
): void {
  ctx.fillStyle = THEME.frameFill
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.lineWidth = WEIGHT.frame
  ctx.strokeStyle = THEME.frameLine
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
}

/**
 * The rule the user keeps bumping into, drawn rather than merely enforced: the
 * altitudes of the vanishing-point triangle, meeting at the principal point.
 */
function drawConstraint(
  ctx: CanvasRenderingContext2D,
  vps: readonly VanishingPoint[],
  camera: Camera,
  S: (p: Vec2) => Vec2,
  infiniteLine: (a: Vec2, b: Vec2) => void,
): void {
  const finite = vps.filter((v) => v.kind === 'finite').map((v) => (v as { at: Vec2 }).at)

  ctx.lineWidth = WEIGHT.altitude
  if (finite.length === 3) {
    // Triangle.
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = withAlpha(THEME.frameLine, ALPHA.triangle)
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
      const a = S(finite[i])
      const b = S(finite[(i + 1) % 3])
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()
    ctx.setLineDash([])

    // Altitudes: from each vertex to the foot on the opposite side.
    for (let i = 0; i < 3; i++) {
      const v = finite[i]
      const foot = footOnLine(finite[(i + 1) % 3], finite[(i + 2) % 3], v)
      ctx.strokeStyle = withAlpha(THEME.axis[i], ALPHA.altitude)
      const sa = S(v)
      const sb = S(foot)
      ctx.beginPath()
      ctx.moveTo(sa.x, sa.y)
      ctx.lineTo(sb.x, sb.y)
      ctx.stroke()
    }
  } else if (finite.length === 2) {
    // One vanishing point at infinity: the orthocenter collapses onto the line
    // joining the two finite ones, and the principal point rides along it.
    ctx.strokeStyle = withAlpha(THEME.frameLine, ALPHA.altitude * 1.4)
    ctx.setLineDash([5, 5])
    infiniteLine(finite[0], finite[1])
    ctx.setLineDash([])
  }

  // Principal point = orthocenter.
  const p = S(camera.p)
  ctx.strokeStyle = THEME.muted
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(p.x - 7, p.y)
  ctx.lineTo(p.x + 7, p.y)
  ctx.moveTo(p.x, p.y - 7)
  ctx.lineTo(p.x, p.y + 7)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2)
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Layer 3 — convergence lines
// ---------------------------------------------------------------------------

function drawConvergence(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  line: (a: Vec2, b: Vec2) => void,
  clipRect: { x0: number; y0: number; x1: number; y1: number },
): void {
  ctx.lineWidth = WEIGHT.convergence
  for (const edge of scene.edges) {
    if (edge.axis < 0 || !edge.seg) continue
    const vp = scene.vps[edge.axis]
    ctx.strokeStyle = withAlpha(THEME.axis[edge.axis], ALPHA.convergence)
    const [a, b] = edge.seg

    if (vp.kind === 'finite') {
      // Continue from whichever end already points at the vanishing point.
      const from = dist2(a, vp.at) < dist2(b, vp.at) ? a : b
      const seg = clipSegmentToRect(from, vp.at, clipRect)
      if (seg) line(seg[0], seg[1])
    } else {
      // Parallel family: extend the edge both ways to the viewport border.
      const far = 1e5
      const ahead = dot2(sub2(b, a), vp.dir) >= 0 ? b : a
      const behind = ahead === b ? a : b
      const s1 = clipSegmentToRect(ahead, add2(ahead, mul2(vp.dir, far)), clipRect)
      if (s1) line(s1[0], s1[1])
      const s2 = clipSegmentToRect(behind, add2(behind, mul2(vp.dir, -far)), clipRect)
      if (s2) line(s2[0], s2[1])
    }
  }
}

/** Clip a *segment* (not a line) to the viewport rectangle. */
function clipSegmentToRect(
  a: Vec2,
  b: Vec2,
  rect: { x0: number; y0: number; x1: number; y1: number },
): [Vec2, Vec2] | null {
  const inside = (p: Vec2) => p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1
  if (inside(a) && inside(b)) return [a, b]
  const full = clipLineToRect(a, b, rect)
  if (!full) return null
  // Restrict the clipped line back to the original segment's parameter range.
  const dx = b.x - a.x
  const dy = b.y - a.y
  const denom = dx * dx + dy * dy
  if (denom < 1e-12) return null
  const param = (p: Vec2) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / denom
  let t0 = param(full[0])
  let t1 = param(full[1])
  if (t0 > t1) [t0, t1] = [t1, t0]
  t0 = Math.max(t0, 0)
  t1 = Math.min(t1, 1)
  if (t0 > t1) return null
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ]
}

// ---------------------------------------------------------------------------
// Layer 4 — tangent lines from each vanishing point to the silhouette
// ---------------------------------------------------------------------------

function drawTangents(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  infiniteLine: (a: Vec2, b: Vec2) => void,
): void {
  const hull = scene.hull
  if (hull.length < 2) return
  ctx.lineWidth = WEIGHT.tangent

  for (let axis = 0; axis < 3; axis++) {
    const vp = scene.vps[axis]
    ctx.strokeStyle = withAlpha(THEME.axis[axis], ALPHA.tangent)

    if (vp.kind === 'finite') {
      const idx = tangentIndicesFrom(hull, vp.at)
      if (!idx) continue
      for (const i of idx) infiniteLine(vp.at, hull[i])
    } else {
      // Supporting lines parallel to the direction: the hull vertices with the
      // extreme perpendicular offset.
      let lo = 0
      let hi = 0
      for (let i = 1; i < hull.length; i++) {
        if (cross2(vp.dir, hull[i]) < cross2(vp.dir, hull[lo])) lo = i
        if (cross2(vp.dir, hull[i]) > cross2(vp.dir, hull[hi])) hi = i
      }
      for (const i of [lo, hi]) infiniteLine(hull[i], add2(hull[i], vp.dir))
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 5 — the object
// ---------------------------------------------------------------------------

function drawObject(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  S: (p: Vec2) => Vec2,
  line: (a: Vec2, b: Vec2) => void,
  toggles: Toggles,
): void {
  if (toggles.shaded) {
    for (const face of scene.faces) {
      if (!face.front || face.poly.length < 3) continue
      ctx.beginPath()
      face.poly.forEach((p, i) => {
        const s = S(p)
        if (i === 0) ctx.moveTo(s.x, s.y)
        else ctx.lineTo(s.x, s.y)
      })
      ctx.closePath()
      ctx.fillStyle = shadeColor(face.shade)
      ctx.fill()
      // A hairline of the same value keeps adjacent facets of the cylinder from
      // showing seams from antialiasing.
      ctx.strokeStyle = ctx.fillStyle
      ctx.lineWidth = 0.75
      ctx.stroke()
    }
  }

  // Hidden edges first, so visible ink always wins the overlap.
  if (toggles.hiddenLines && !toggles.shaded) {
    ctx.setLineDash([4, 4])
    ctx.lineWidth = WEIGHT.hidden
    ctx.strokeStyle = withAlpha(THEME.ink, ALPHA.hidden)
    for (const edge of scene.edges) {
      if (edge.hidden && edge.seg) line(edge.seg[0], edge.seg[1])
    }
    ctx.setLineDash([])
  }

  ctx.lineWidth = WEIGHT.object
  ctx.strokeStyle = THEME.ink
  for (const edge of scene.edges) {
    if (!edge.seg) continue
    if (edge.hidden && (toggles.hiddenLines || toggles.shaded)) continue
    line(edge.seg[0], edge.seg[1])
  }
  for (const [a, b] of scene.silhouette) line(a, b)
}

// ---------------------------------------------------------------------------
// Layer 6 — handles
// ---------------------------------------------------------------------------

/**
 * Screen position of a vanishing-point handle. Points at infinity get parked on
 * the viewport border along their direction, so they stay grabbable.
 */
export function handleScreenPosition(
  vp: VanishingPoint,
  camera: Camera,
  view: Viewport,
  width: number,
  height: number,
): Vec2 {
  if (vp.kind === 'finite') return toScreen(view, vp.at)
  const origin = toScreen(view, camera.p)
  const rect = {
    x0: INFINITY_INSET,
    y0: INFINITY_INSET,
    x1: width - INFINITY_INSET,
    y1: height - INFINITY_INSET,
  }
  const d = norm2(vp.dir)
  // Distance to the nearest border along +d.
  let t = Math.min(
    d.x > 0 ? (rect.x1 - origin.x) / d.x : d.x < 0 ? (rect.x0 - origin.x) / d.x : Infinity,
    d.y > 0 ? (rect.y1 - origin.y) / d.y : d.y < 0 ? (rect.y0 - origin.y) / d.y : Infinity,
  )
  if (!Number.isFinite(t) || t < 60) t = 60
  return { x: origin.x + d.x * t, y: origin.y + d.y * t }
}

function drawHandles(
  ctx: CanvasRenderingContext2D,
  vps: readonly VanishingPoint[],
  camera: Camera,
  S: (p: Vec2) => Vec2,
  input: DrawInput,
): void {
  const { view, width, height, toggles } = input
  ctx.font = `600 11px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let axis = 0; axis < 3; axis++) {
    const vp = vps[axis]
    const pos = handleScreenPosition(vp, camera, view, width, height)
    const color = THEME.axis[axis]
    const active = input.activeHandle === axis
    const hover = input.hoverHandle === axis
    const r = HANDLE_RADIUS + (active ? 2.5 : hover ? 1.5 : 0)

    if (vp.kind === 'infinite') {
      // A tether back to the principal point makes it clear the handle is a
      // direction, not a location.
      const origin = S(camera.p)
      ctx.strokeStyle = withAlpha(color, 0.22)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(origin.x, origin.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.beginPath()
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
    ctx.fillStyle = THEME.paper
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = active || hover ? 2.2 : 1.6
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 2.2, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()

    if (toggles.labels) {
      const label = vp.kind === 'infinite' ? `${AXIS_LABELS[axis]}∞` : AXIS_LABELS[axis]
      const off = r + 11
      ctx.fillStyle = color
      ctx.fillText(label, pos.x + off, pos.y - off * 0.55)
    }
  }
}
