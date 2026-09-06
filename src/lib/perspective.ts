/**
 * Pure geometry + camera math for three-point perspective.
 *
 * No React, no canvas, no DOM. Everything here is inspectable and testable.
 *
 * Conventions
 * -----------
 * Camera space is right-handed: +x right, +y up, +z forward (into the scene).
 * Image space ("frame pixels") has +x right and +y DOWN, like a canvas.
 *
 * A point X in camera space projects to
 *     screen = ( px + f * X.x / X.z ,  py - f * X.y / X.z )
 *
 * The vanishing point of a direction d (camera space) is the projection of the
 * point at infinity along d, i.e. the limit of the above as the point recedes:
 *     V = ( px + f * d.x / d.z , py - f * d.y / d.z )
 * which is finite exactly when d.z != 0.
 *
 * Inverting that, a vanishing point V corresponds to the direction
 *     d ∝ ( (Vx - px)/f , -(Vy - py)/f , 1 )
 * and orthogonality of two axis directions, d_i · d_j = 0, expands to
 *     (Vi - p) · (Vj - p) + f² = 0.
 *
 * Two consequences drive the whole app:
 *   1. p is the orthocenter of triangle V1 V2 V3.
 *   2. f² = -(V1 - p)·(V2 - p), positive only for an acute triangle.
 */

// ---------------------------------------------------------------------------
// Small vector / matrix toolkit
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number
  y: number
}
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Row-major 3x3. Column i is (m[i], m[3+i], m[6+i]). */
export type Mat3 = readonly number[]

export const DEG = Math.PI / 180

export const v2 = (x: number, y: number): Vec2 => ({ x, y })
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const mul2 = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const len2 = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export function norm2(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y)
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }
}
/** Rotate 90° (in the algebraic sense; on a y-down canvas this reads as clockwise). */
export const perp2 = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const mul3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
export function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z)
  return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 }
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export const matCol = (m: Mat3, i: number): Vec3 => ({ x: m[i], y: m[3 + i], z: m[6 + i] })

export const matFromCols = (c0: Vec3, c1: Vec3, c2: Vec3): Mat3 => [
  c0.x, c1.x, c2.x,
  c0.y, c1.y, c2.y,
  c0.z, c1.z, c2.z,
]

export const matMulVec = (m: Mat3, v: Vec3): Vec3 => ({
  x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
  y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
  z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
})

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
    }
  }
  return out
}

export const matDet = (m: Mat3): number =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[1] * (m[3] * m[8] - m[5] * m[6]) +
  m[2] * (m[3] * m[7] - m[4] * m[6])

/** Frobenius distance, used as the continuity metric between frames. */
export function matDistance(a: Mat3, b: Mat3): number {
  let s = 0
  for (let i = 0; i < 9; i++) s += (a[i] - b[i]) * (a[i] - b[i])
  return Math.sqrt(s)
}

/** Rodrigues rotation about a unit axis. */
export function rotationAxisAngle(axis: Vec3, angle: number): Mat3 {
  const a = norm3(axis)
  if (a.x === 0 && a.y === 0 && a.z === 0) return IDENTITY
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  const { x, y, z } = a
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}

/** Re-orthonormalise columns (modified Gram-Schmidt) to stop drift after many rotations. */
export function orthonormalize(m: Mat3): Mat3 {
  const c0 = norm3(matCol(m, 0))
  const raw1 = matCol(m, 1)
  const c1 = norm3(sub3(raw1, mul3(c0, dot3(c0, raw1))))
  const c2 = cross3(c0, c1)
  return matFromCols(c0, c1, c2)
}

// Euler convention: R = Ry(yaw) · Rx(pitch) · Rz(roll), angles in radians.
export function matFromEuler(yaw: number, pitch: number, roll: number): Mat3 {
  const ca = Math.cos(yaw)
  const sa = Math.sin(yaw)
  const cb = Math.cos(pitch)
  const sb = Math.sin(pitch)
  const cc = Math.cos(roll)
  const sc = Math.sin(roll)
  return [
    ca * cc + sa * sb * sc, -ca * sc + sa * sb * cc, sa * cb,
    cb * sc, cb * cc, -sb,
    -sa * cc + ca * sb * sc, sa * sc + ca * sb * cc, ca * cb,
  ]
}

export function matToEuler(m: Mat3): { yaw: number; pitch: number; roll: number } {
  const sb = Math.max(-1, Math.min(1, -m[5]))
  const pitch = Math.asin(sb)
  const cb = Math.sqrt(Math.max(0, 1 - sb * sb))
  if (cb < 1e-7) {
    // Gimbal lock: fold roll into yaw.
    return { yaw: Math.atan2(-m[2], m[0]), pitch, roll: 0 }
  }
  return { yaw: Math.atan2(m[2], m[8]), pitch, roll: Math.atan2(m[3], m[4]) }
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * The single source of truth: 6 degrees of freedom.
 * R maps object axes to camera axes (column i is object axis i in camera space).
 */
export interface Camera {
  R: Mat3
  /** focal length, in frame pixels */
  f: number
  /** principal point, in frame pixels */
  p: Vec2
}

export type VanishingPoint =
  | { kind: 'finite'; at: Vec2 }
  /** dir is a unit screen-space direction; the parallel lines run along ±dir. */
  | { kind: 'infinite'; dir: Vec2 }

/** |column.z| below this counts as "vanishing point at infinity". */
export const INFINITY_EPS = 1e-9

export function vanishingPointForAxis(cam: Camera, axis: number, eps = INFINITY_EPS): VanishingPoint {
  const c = matCol(cam.R, axis)
  if (Math.abs(c.z) <= eps) {
    return { kind: 'infinite', dir: norm2({ x: c.x, y: -c.y }) }
  }
  return {
    kind: 'finite',
    at: { x: cam.p.x + (cam.f * c.x) / c.z, y: cam.p.y - (cam.f * c.y) / c.z },
  }
}

export function vanishingPoints(cam: Camera, eps = INFINITY_EPS): [VanishingPoint, VanishingPoint, VanishingPoint] {
  return [
    vanishingPointForAxis(cam, 0, eps),
    vanishingPointForAxis(cam, 1, eps),
    vanishingPointForAxis(cam, 2, eps),
  ]
}

/** Indices of axes whose vanishing point is at infinity. */
export function infiniteAxes(cam: Camera, eps = INFINITY_EPS): number[] {
  const out: number[] = []
  for (let i = 0; i < 3; i++) if (Math.abs(matCol(cam.R, i).z) <= eps) out.push(i)
  return out
}

/** Project a camera-space point into frame pixels. Caller must ensure X.z > 0. */
export const projectCamera = (cam: Camera, X: Vec3): Vec2 => ({
  x: cam.p.x + (cam.f * X.x) / X.z,
  y: cam.p.y - (cam.f * X.y) / X.z,
})

/**
 * Camera-space center placing the object so that it projects exactly onto the
 * screen anchor `a`, at depth D.
 */
export const centerFromAnchor = (cam: Camera, a: Vec2, D: number): Vec3 => ({
  x: (D * (a.x - cam.p.x)) / cam.f,
  y: (-D * (a.y - cam.p.y)) / cam.f,
  z: D,
})

/** Object vertex -> camera space: Xcam = R·(scale·X) + c */
export function objectToCamera(R: Mat3, scale: number, X: Vec3, c: Vec3): Vec3 {
  const s = matMulVec(R, { x: X.x * scale, y: X.y * scale, z: X.z * scale })
  return { x: s.x + c.x, y: s.y + c.y, z: s.z + c.z }
}

// ---------------------------------------------------------------------------
// Recovery: three vanishing points -> { R, f, p }
// ---------------------------------------------------------------------------

/**
 * Orthocenter of triangle (a, b, c).
 *
 * Subtracting pairs of the orthogonality equations gives (p - Vi)·(Vj - Vk) = 0,
 * i.e. p lies on every altitude. Two altitudes make a 2x2 linear system.
 * Returns null when the triangle is degenerate (collinear or coincident).
 */
export function orthocenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const bc = sub2(b, c)
  const ca = sub2(c, a)
  // [ bc.x bc.y ] [px]   [ a·bc ]
  // [ ca.x ca.y ] [py] = [ b·ca ]
  const det = bc.x * ca.y - bc.y * ca.x
  const scale = Math.max(dist2(a, b), dist2(b, c), dist2(c, a))
  if (!(Math.abs(det) > 1e-9 * Math.max(scale * scale, 1e-12))) return null
  const r1 = dot2(a, bc)
  const r2 = dot2(b, ca)
  return { x: (r1 * ca.y - bc.y * r2) / det, y: (bc.x * r2 - r1 * ca.x) / det }
}

export type RecoverFailure = 'degenerate' | 'nonacute'

export type RecoverResult =
  | { ok: true; camera: Camera; f2: number }
  | { ok: false; reason: RecoverFailure; f2: number; p: Vec2 | null }

/**
 * Choose the sign of each axis direction.
 *
 * Each di is only determined up to sign. We need det(R) = +1, and we want the
 * result to be continuous with the previous frame — otherwise the object flips
 * and pops as the user drags. Maximising Σ si·(di·prev_col_i) minimises
 * ‖R - R_prev‖_F, and the determinant constraint fixes the parity of the signs,
 * so if the greedy choice has the wrong parity we flip whichever axis is least
 * committed (smallest |di · prev_col_i|).
 */
export function chooseAxisSigns(d: [Vec3, Vec3, Vec3], prevR: Mat3): [number, number, number] {
  const baseDet = matDet(matFromCols(d[0], d[1], d[2]))
  const wantParity = baseDet >= 0 ? 1 : -1 // s1·s2·s3 must equal sign(baseDet)
  const t = [0, 1, 2].map((i) => dot3(d[i], matCol(prevR, i)))
  const s: [number, number, number] = [
    t[0] >= 0 ? 1 : -1,
    t[1] >= 0 ? 1 : -1,
    t[2] >= 0 ? 1 : -1,
  ]
  if (s[0] * s[1] * s[2] !== wantParity) {
    let k = 0
    for (let i = 1; i < 3; i++) if (Math.abs(t[i]) < Math.abs(t[k])) k = i
    s[k] = -s[k]
  }
  return s
}

/**
 * The main inverse map. Given three vanishing points, recover the camera.
 *
 * `minFocal` sets how close to the acute/obtuse boundary we are willing to go;
 * f below it is treated as "no real camera here" and gives the drag clamp its
 * margin.
 */
export function recoverCameraFromVPs(
  v1: Vec2,
  v2: Vec2,
  v3: Vec2,
  prevR: Mat3 = IDENTITY,
  minFocal = 0,
): RecoverResult {
  const p = orthocenter(v1, v2, v3)
  if (!p) return { ok: false, reason: 'degenerate', f2: Number.NaN, p: null }

  const a = sub2(v1, p)
  const b = sub2(v2, p)
  const c = sub2(v3, p)
  // All three pairings agree analytically; averaging costs nothing and is kinder
  // to floating point when the triangle is very large or very thin.
  const f2 = -(dot2(a, b) + dot2(b, c) + dot2(c, a)) / 3

  if (!(f2 > minFocal * minFocal) || !Number.isFinite(f2)) {
    return { ok: false, reason: 'nonacute', f2, p }
  }

  const f = Math.sqrt(f2)
  const d: [Vec3, Vec3, Vec3] = [
    norm3({ x: a.x / f, y: -a.y / f, z: 1 }),
    norm3({ x: b.x / f, y: -b.y / f, z: 1 }),
    norm3({ x: c.x / f, y: -c.y / f, z: 1 }),
  ]
  const s = chooseAxisSigns(d, prevR)
  const R = matFromCols(mul3(d[0], s[0]), mul3(d[1], s[1]), mul3(d[2], s[2]))
  return { ok: true, camera: { R, f, p }, f2 }
}

export interface LenientRecoverResult {
  camera: Camera
  /** False means the three directions built into `camera.R` are not mutually orthogonal. */
  valid: boolean
  f2: number
}

/**
 * Like `recoverCameraFromVPs`, but never refuses a triangle just for being
 * obtuse: it uses `f = sqrt(|f2|)`, which agrees with the strict formula on the
 * acute side and stays continuous straight through f2 = 0 into the obtuse side.
 * The three axis directions built from that are still unit vectors, but they
 * are no longer mutually perpendicular — `camera.R`'s columns describe the
 * actual (sheared) parallelepiped that triangle implies, not a cube, and
 * `valid` says which case we're in.
 *
 * Only a truly degenerate (collinear) triple has no orthocenter at all and
 * returns null — there is no triangle, let alone a shape, to fall back to.
 */
export function recoverCameraLenient(
  v1: Vec2,
  v2: Vec2,
  v3: Vec2,
  prevR: Mat3 = IDENTITY,
): LenientRecoverResult | null {
  const p = orthocenter(v1, v2, v3)
  if (!p) return null

  const a = sub2(v1, p)
  const b = sub2(v2, p)
  const c = sub2(v3, p)
  const f2 = -(dot2(a, b) + dot2(b, c) + dot2(c, a)) / 3
  if (!Number.isFinite(f2)) return null

  // The 1px floor only guards the literal division by zero right at f2 = 0;
  // it has no visible effect anywhere else.
  const f = Math.sqrt(Math.max(Math.abs(f2), 1))
  const d: [Vec3, Vec3, Vec3] = [
    norm3({ x: a.x / f, y: -a.y / f, z: 1 }),
    norm3({ x: b.x / f, y: -b.y / f, z: 1 }),
    norm3({ x: c.x / f, y: -c.y / f, z: 1 }),
  ]
  const s = chooseAxisSigns(d, prevR)
  const R = matFromCols(mul3(d[0], s[0]), mul3(d[1], s[1]), mul3(d[2], s[2]))
  return { camera: { R, f, p }, valid: f2 > 0, f2 }
}

/**
 * Worst-case |di·dj| among the three axis pairs of R's columns — 0 for a true
 * rotation, and equal to cos(angle between them) when it isn't one. Works on
 * any R, so it's a fine way to ask "is this actually an orthogonal camera?"
 * without knowing how R was built.
 */
export function orthogonalityError(R: Mat3): number {
  const d0 = matCol(R, 0)
  const d1 = matCol(R, 1)
  const d2 = matCol(R, 2)
  return Math.max(Math.abs(dot3(d0, d1)), Math.abs(dot3(d1, d2)), Math.abs(dot3(d2, d0)))
}

/** The worst-offending pair's deviation from 90°, in degrees — for a human-readable warning. */
export function orthogonalityErrorDegrees(R: Mat3): number {
  const k = Math.min(1, orthogonalityError(R))
  return 90 - (Math.acos(k) * 180) / Math.PI
}

// ---------------------------------------------------------------------------
// Dragging a vanishing point, with the acute-triangle constraint
// ---------------------------------------------------------------------------

export interface DragClampResult {
  /** Where the handle actually ended up. */
  point: Vec2
  /** True when the request was rejected and we settled short of it. */
  clamped: boolean
  camera: Camera | null
  reason: RecoverFailure | null
}

/**
 * Move vanishing point `index` toward `target`, refusing to cross out of the
 * acute region. When the target is invalid we bisect along the segment from the
 * last valid position and settle on the last point that still resolves to a real
 * camera (with `minFocal` supplying the margin).
 */
export function clampVanishingPointDrag(
  vps: readonly [Vec2, Vec2, Vec2],
  index: number,
  target: Vec2,
  prevR: Mat3,
  minFocal = 20,
  iterations = 28,
): DragClampResult {
  const trial = (pt: Vec2): RecoverResult => {
    const t: [Vec2, Vec2, Vec2] = [vps[0], vps[1], vps[2]]
    t[index] = pt
    return recoverCameraFromVPs(t[0], t[1], t[2], prevR, minFocal)
  }

  const direct = trial(target)
  if (direct.ok) return { point: target, clamped: false, camera: direct.camera, reason: null }

  const from = vps[index]
  const base = trial(from)
  if (!base.ok) {
    // Shouldn't happen — the current configuration is always a valid one — but
    // never hand back NaN.
    return { point: from, clamped: true, camera: null, reason: direct.reason }
  }

  let lo = 0 // known valid
  let hi = 1 // known invalid
  let best = base
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2
    const r = trial(lerp2(from, target, mid))
    if (r.ok) {
      lo = mid
      best = r
    } else {
      hi = mid
    }
  }
  return {
    point: lerp2(from, target, lo),
    clamped: true,
    camera: best.camera,
    reason: direct.reason,
  }
}

// ---------------------------------------------------------------------------
// Limiting cases: one or two vanishing points at infinity
// ---------------------------------------------------------------------------

/**
 * Rotate the camera minimally so that axis `k`'s vanishing point is at infinity
 * (its camera-space direction becomes parallel to the image plane).
 *
 * If exactly one other axis is already at infinity we rotate about that axis, so
 * it stays at infinity — this is what turns two-point perspective into one-point.
 * Returns null when nothing sensible can be done.
 */
export function sendAxisToInfinity(R: Mat3, k: number, eps = 1e-7): Mat3 | null {
  const cols = [matCol(R, 0), matCol(R, 1), matCol(R, 2)]
  const ck = cols[k]
  if (Math.abs(ck.z) <= INFINITY_EPS) return R

  const already = [0, 1, 2].filter((i) => i !== k && Math.abs(cols[i].z) <= eps)
  // Three mutually orthogonal directions cannot all be parallel to the image
  // plane, so with two already at infinity there is nowhere left to go.
  if (already.length >= 2) return null

  if (already.length === 0) {
    // Minimal rotation taking ck onto its projection into the image plane.
    const flat = { x: ck.x, y: ck.y, z: 0 }
    const l = Math.hypot(flat.x, flat.y)
    const target = l > 1e-9 ? { x: flat.x / l, y: flat.y / l, z: 0 } : { x: 1, y: 0, z: 0 }
    const axis = cross3(ck, target)
    if (len3(axis) < 1e-12) return R
    const angle = Math.acos(Math.max(-1, Math.min(1, dot3(ck, target))))
    return orthonormalize(matMul(rotationAxisAngle(axis, angle), R))
  }

  // Rotate about the axis that is already at infinity; ck sweeps the plane
  // perpendicular to it, which contains the camera z axis, so a solution exists.
  const j = already[0]
  const cj = cols[j]
  const w = cross3(cj, ck)
  if (Math.abs(ck.z) < 1e-12 && Math.abs(w.z) < 1e-12) return R
  const angle = Math.atan2(-ck.z, w.z)
  return orthonormalize(matMul(rotationAxisAngle(cj, angle), R))
}

/** Tilt axis `k` off the image plane so its vanishing point becomes finite again. */
export function bringAxisBackFromInfinity(R: Mat3, k: number, angle = 14 * DEG): Mat3 {
  const ck = matCol(R, k)
  if (Math.abs(ck.z) > INFINITY_EPS) return R
  const axis = cross3(ck, { x: 0, y: 0, z: 1 })
  if (len3(axis) < 1e-12) return R
  return orthonormalize(matMul(rotationAxisAngle(axis, angle), R))
}

/**
 * Drag a finite vanishing point while axis `inf` is pinned at infinity.
 *
 * With one vanishing point at infinity the orthocenter construction collapses:
 * (Vi - p)·u = 0 for both finite VPs forces u ⟂ ViVj and puts p *on* the segment
 * ViVj, with f² = |Vi - p|·|Vj - p|. The remaining freedom is where p sits along
 * that segment, which we hold fixed (as a fraction) so the drag feels stable.
 */
export function recoverWithOneAxisAtInfinity(
  finiteA: { axis: number; at: Vec2 },
  finiteB: { axis: number; at: Vec2 },
  infAxis: number,
  t: number,
  prevR: Mat3,
  minFocal = 20,
): RecoverResult {
  const seg = sub2(finiteB.at, finiteA.at)
  const L = len2(seg)
  const tc = Math.min(1 - 1e-4, Math.max(1e-4, t))
  if (!(L > 2 * minFocal)) {
    return { ok: false, reason: 'nonacute', f2: (L * L) / 4, p: null }
  }
  const p = lerp2(finiteA.at, finiteB.at, tc)
  const f2 = L * tc * (L * (1 - tc))
  if (!(f2 > minFocal * minFocal)) return { ok: false, reason: 'nonacute', f2, p }
  const f = Math.sqrt(f2)

  const a = sub2(finiteA.at, p)
  const b = sub2(finiteB.at, p)
  // u must be perpendicular to the segment; pick the sign closest to the axis's
  // current screen direction so the drag stays continuous.
  const prevCol = matCol(prevR, infAxis)
  let u = norm2(perp2(norm2(seg)))
  if (u.x * prevCol.x + u.y * -prevCol.y < 0) u = { x: -u.x, y: -u.y }

  const d: [Vec3, Vec3, Vec3] = [v3(0, 0, 1), v3(0, 0, 1), v3(0, 0, 1)]
  d[finiteA.axis] = norm3({ x: a.x / f, y: -a.y / f, z: 1 })
  d[finiteB.axis] = norm3({ x: b.x / f, y: -b.y / f, z: 1 })
  d[infAxis] = norm3({ x: u.x, y: -u.y, z: 0 })

  const s = chooseAxisSigns(d, prevR)
  const R = matFromCols(mul3(d[0], s[0]), mul3(d[1], s[1]), mul3(d[2], s[2]))
  return { ok: true, camera: { R, f, p }, f2 }
}

/** Fraction of the way from a to b at which p sits (projected onto the segment). */
export function segmentParameter(a: Vec2, b: Vec2, p: Vec2): number {
  const seg = sub2(b, a)
  const l2 = dot2(seg, seg)
  if (l2 < 1e-12) return 0.5
  return dot2(sub2(p, a), seg) / l2
}

// ---------------------------------------------------------------------------
// Screen-space geometry helpers
// ---------------------------------------------------------------------------

/** Clip a camera-space segment against the near plane z >= zMin. */
export function clipSegmentNear(a: Vec3, b: Vec3, zMin: number): [Vec3, Vec3] | null {
  const inA = a.z >= zMin
  const inB = b.z >= zMin
  if (inA && inB) return [a, b]
  if (!inA && !inB) return null
  const t = (zMin - a.z) / (b.z - a.z)
  const m: Vec3 = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: zMin }
  return inA ? [a, m] : [m, b]
}

/** Sutherland–Hodgman clip of a camera-space polygon against z >= zMin. */
export function clipPolygonNear(poly: readonly Vec3[], zMin: number): Vec3[] {
  const out: Vec3[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const aIn = a.z >= zMin
    const bIn = b.z >= zMin
    if (aIn) out.push(a)
    if (aIn !== bIn) {
      const t = (zMin - a.z) / (b.z - a.z)
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: zMin })
    }
  }
  return out
}

/**
 * Newell's method: an area-weighted normal that stays sensible for n-gons and
 * for slightly non-planar or nearly degenerate polygons.
 */
export function newellNormal(poly: readonly Vec3[]): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    nx += (a.y - b.y) * (a.z + b.z)
    ny += (a.z - b.z) * (a.x + b.x)
    nz += (a.x - b.x) * (a.y + b.y)
  }
  return norm3({ x: nx, y: ny, z: nz })
}

/**
 * Andrew's monotone chain, returning indices into `points` so callers can carry
 * per-vertex data (such as which rim of a cylinder a point came from) onto the hull.
 */
export function convexHullIndices(points: readonly Vec2[]): number[] {
  const n = points.length
  if (n < 3) return points.map((_, i) => i)
  const order = points.map((_, i) => i).sort((i, j) => {
    const a = points[i]
    const b = points[j]
    return a.x === b.x ? a.y - b.y : a.x - b.x
  })
  const cross = (o: number, a: number, b: number) =>
    (points[a].x - points[o].x) * (points[b].y - points[o].y) -
    (points[a].y - points[o].y) * (points[b].x - points[o].x)

  const build = (seq: number[]): number[] => {
    const stack: number[] = []
    for (const idx of seq) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], idx) <= 0) stack.pop()
      stack.push(idx)
    }
    stack.pop()
    return stack
  }
  const lower = build(order)
  const upper = build(order.slice().reverse())
  const hull = lower.concat(upper)
  return hull.length >= 3 ? hull : order.slice(0, Math.min(2, n))
}

/** Andrew's monotone chain. Returns a convex cycle; interior points removed. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  if (points.length < 3) return points.slice()
  return convexHullIndices(points).map((i) => points[i])
}

/**
 * The two hull vertices of extreme angular position as seen from `v`.
 *
 * Walking the convex cycle, the signed area of (v, h_i, h_{i+1}) keeps one sign
 * along the near chain and the other along the far chain; the tangent points are
 * exactly where that sign flips. Returns null when v is inside the hull.
 */
export function tangentIndicesFrom(hull: readonly Vec2[], v: Vec2): [number, number] | null {
  const n = hull.length
  if (n < 2) return null
  const signs = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % n]
    signs[i] = Math.sign((a.x - v.x) * (b.y - v.y) - (a.y - v.y) * (b.x - v.x))
  }
  const flips: number[] = []
  for (let i = 0; i < n; i++) {
    const prev = signs[(i - 1 + n) % n]
    const cur = signs[i]
    if (prev !== 0 && cur !== 0 && prev !== cur) flips.push(i)
  }
  if (flips.length < 2) return null
  return [flips[0], flips[flips.length - 1]]
}

export function pointInConvexPolygon(poly: readonly Vec2[], q: Vec2): boolean {
  const n = poly.length
  if (n < 3) return false
  let pos = 0
  let neg = 0
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const c = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)
    if (c > 0) pos++
    else if (c < 0) neg++
  }
  return pos === 0 || neg === 0
}

/** Foot of the perpendicular from p onto the infinite line through a and b. */
export function footOnLine(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const seg = sub2(b, a)
  const l2 = dot2(seg, seg)
  if (l2 < 1e-12) return a
  const t = dot2(sub2(p, a), seg) / l2
  return lerp2(a, b, t)
}

/**
 * Clip the infinite line through a and b to an axis-aligned rectangle
 * (Liang–Barsky on the parametric form). Used to keep guide lines from running
 * off to absurd coordinates.
 */
export function clipLineToRect(
  a: Vec2,
  b: Vec2,
  rect: { x0: number; y0: number; x1: number; y1: number },
): [Vec2, Vec2] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null
  let t0 = -Infinity
  let t1 = Infinity
  // For each half-plane, the constraint is p·t <= q.
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0 // parallel: inside iff already satisfied
    const t = q / p
    if (p < 0) {
      if (t > t0) t0 = t
    } else if (t < t1) t1 = t
    return true
  }
  if (!clip(-dx, a.x - rect.x0)) return null
  if (!clip(dx, rect.x1 - a.x)) return null
  if (!clip(-dy, a.y - rect.y0)) return null
  if (!clip(dy, rect.y1 - a.y)) return null
  if (t0 > t1) return null
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ]
}
