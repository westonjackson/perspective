/**
 * Every control in the UI ultimately writes into { R, f, p }. This module is
 * where each gesture is turned into that write. Pure — it takes a camera and
 * returns a camera.
 */

import {
  type Camera,
  type Mat3,
  type Vec2,
  DEG,
  dist2,
  infiniteAxes,
  lerp2,
  matMul,
  norm2,
  orthonormalize,
  recoverCameraLenient,
  recoverWithOneAxisAtInfinity,
  rotationAxisAngle,
  segmentParameter,
  sub2,
  vanishingPointForAxis,
} from './perspective'

export const MIN_FOCAL = 24

export interface DragOutcome {
  camera: Camera
  /**
   * The three vanishing points no longer describe a real, mutually-orthogonal
   * camera. `camera` still updates — it renders as the actual (sheared)
   * parallelepiped that triangle implies, not a cube — this only flags it.
   */
  invalid: boolean
  /**
   * The exact target was refused and we settled for the nearest point we
   * could: the only way to reach this is a true singularity (three vanishing
   * points exactly collinear, or two of them coinciding), which has no
   * orthocenter — and so no shape at all — to fall back to.
   */
  refused: boolean
}

const unchanged = (camera: Camera): DragOutcome => ({ camera, invalid: false, refused: false })

/**
 * Move vanishing point `axis` toward `target` (frame pixels), respecting the
 * acute-triangle constraint and whatever limiting case we happen to be in.
 */
export function dragVanishingPoint(
  camera: Camera,
  axis: number,
  target: Vec2,
  minFocal = MIN_FOCAL,
): DragOutcome {
  const inf = infiniteAxes(camera)

  // --- the handle being dragged is itself at infinity ---------------------
  // Its direction is the only thing that can move, and turning it means
  // rotating the whole camera about its optical axis.
  if (inf.includes(axis)) {
    const current = vanishingPointForAxis(camera, axis)
    if (current.kind !== 'infinite') return unchanged(camera)
    const wanted = sub2(target, camera.p)
    if (Math.hypot(wanted.x, wanted.y) < 1e-6) return unchanged(camera)
    const to = norm2(wanted)
    // Screen angles run opposite to camera-space angles (canvas y points down),
    // so a screen rotation of Δψ is a camera rotation of -Δψ about z.
    const deltaScreen = Math.atan2(to.y, to.x) - Math.atan2(current.dir.y, current.dir.x)
    const R = orthonormalize(matMul(rotationAxisAngle({ x: 0, y: 0, z: 1 }, -deltaScreen), camera.R))
    return unchanged({ ...camera, R })
  }

  const others = [0, 1, 2].filter((i) => i !== axis)

  // --- two at infinity: one-point perspective -----------------------------
  // The single finite vanishing point *is* the principal point, and f is free,
  // so dragging it simply slides the picture plane.
  if (inf.length === 2) {
    return unchanged({ ...camera, p: target })
  }

  // --- one at infinity: two-point perspective -----------------------------
  // p is pinned to the segment joining the two finite vanishing points. We hold
  // its fraction along that segment so the drag stays predictable.
  if (inf.length === 1) {
    const infAxis = inf[0]
    const otherAxis = others.find((i) => i !== infAxis)!
    const otherVp = vanishingPointForAxis(camera, otherAxis)
    const selfVp = vanishingPointForAxis(camera, axis)
    if (otherVp.kind !== 'finite' || selfVp.kind !== 'finite') return unchanged(camera)

    const t = segmentParameter(selfVp.at, otherVp.at, camera.p)
    const attempt = (at: Vec2) =>
      recoverWithOneAxisAtInfinity(
        { axis, at },
        { axis: otherAxis, at: otherVp.at },
        infAxis,
        t,
        camera.R,
        minFocal,
      )

    const direct = attempt(target)
    if (direct.ok) return { camera: direct.camera, invalid: false, refused: false }
    const settled = bisect(selfVp.at, target, (pt) => attempt(pt).ok)
    const res = attempt(settled)
    return {
      camera: res.ok ? res.camera : camera,
      invalid: false,
      refused: true,
    }
  }

  // --- the general case: three finite vanishing points --------------------
  // No acute-triangle requirement here: land exactly on the target regardless
  // of what triangle results, and only flag it as `invalid` when it isn't a
  // real camera. The one thing with no fallback at all is an exactly
  // collinear triple, which has no orthocenter — that alone is refused.
  const vps = [0, 1, 2].map((i) => {
    const v = vanishingPointForAxis(camera, i)
    return v.kind === 'finite' ? v.at : null
  })
  if (vps.some((v) => v === null)) return unchanged(camera)

  const next = vps.slice() as [Vec2, Vec2, Vec2]
  next[axis] = target
  const result = recoverCameraLenient(next[0], next[1], next[2], camera.R)
  if (!result) return { camera, invalid: true, refused: true }
  return { camera: result.camera, invalid: !result.valid, refused: false }
}

/** Largest fraction along a->b that still satisfies `ok`. */
function bisect(a: Vec2, b: Vec2, ok: (p: Vec2) => boolean, iterations = 28): Vec2 {
  if (!ok(a)) return a
  let lo = 0
  let hi = 1
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2
    if (ok(lerp2(a, b, mid))) lo = mid
    else hi = mid
  }
  return lerp2(a, b, lo)
}

// ---------------------------------------------------------------------------

/** Trackball rotation from a screen-space drag, applied in the camera frame. */
export function trackballRotate(R: Mat3, dx: number, dy: number, sensitivity = 0.42): Mat3 {
  const yaw = rotationAxisAngle({ x: 0, y: 1, z: 0 }, dx * sensitivity * DEG)
  const pitch = rotationAxisAngle({ x: 1, y: 0, z: 0 }, dy * sensitivity * DEG)
  return orthonormalize(matMul(matMul(pitch, yaw), R))
}

// ---------------------------------------------------------------------------

export interface Bounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Bounding box, in frame pixels, of the picture plane plus every finite
 * vanishing point. Vanishing points at realistic focal lengths sit far outside
 * the frame, which is what makes "fit all" indispensable.
 *
 * An axis that is *nearly* parallel to the picture plane throws its vanishing
 * point out to hundreds of thousands of pixels. Fitting to that would shrink the
 * frame to a speck, so past `maxFocalLengths` we treat the point as effectively
 * at infinity and leave it out.
 */
export function contentBounds(
  camera: Camera,
  frame: { w: number; h: number },
  maxFocalLengths = 40,
): Bounds {
  const b: Bounds = {
    x0: camera.p.x - frame.w / 2,
    y0: camera.p.y - frame.h / 2,
    x1: camera.p.x + frame.w / 2,
    y1: camera.p.y + frame.h / 2,
  }
  const limit = maxFocalLengths * camera.f
  for (let i = 0; i < 3; i++) {
    const vp = vanishingPointForAxis(camera, i)
    if (vp.kind !== 'finite') continue
    if (dist2(vp.at, camera.p) > limit) continue
    b.x0 = Math.min(b.x0, vp.at.x)
    b.y0 = Math.min(b.y0, vp.at.y)
    b.x1 = Math.max(b.x1, vp.at.x)
    b.y1 = Math.max(b.y1, vp.at.y)
  }
  return b
}

export function fitViewport(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 64,
): { zoom: number; tx: number; ty: number } {
  const w = Math.max(bounds.x1 - bounds.x0, 1)
  const h = Math.max(bounds.y1 - bounds.y0, 1)
  // Never magnify past 1:1 — the picture plane is a real measurement, and
  // blowing it up past life size makes the frame read as the subject.
  const zoom = Math.max(
    0.002,
    Math.min((width - padding * 2) / w, (height - padding * 2) / h, 1),
  )
  const cx = (bounds.x0 + bounds.x1) / 2
  const cy = (bounds.y0 + bounds.y1) / 2
  return { zoom, tx: width / 2 - cx * zoom, ty: height / 2 - cy * zoom }
}

