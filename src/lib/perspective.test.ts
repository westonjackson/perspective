import { describe, expect, it } from 'vitest'
import {
  type Camera,
  type Mat3,
  type Vec2,
  clampVanishingPointDrag,
  chooseAxisSigns,
  convexHull,
  clipLineToRect,
  clipSegmentNear,
  dot2,
  dot3,
  IDENTITY,
  infiniteAxes,
  matCol,
  matDet,
  matDistance,
  matFromEuler,
  matToEuler,
  orthocenter,
  orthogonalityError,
  orthogonalityErrorDegrees,
  recoverCameraFromVPs,
  recoverCameraLenient,
  recoverWithOneAxisAtInfinity,
  sendAxisToInfinity,
  sub2,
  tangentIndicesFrom,
  vanishingPointForAxis,
  vanishingPoints,
  DEG,
} from './perspective'

// -- deterministic randomness -------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomRotation(rnd: () => number): Mat3 {
  // Shoemake's uniform random quaternion.
  const u1 = rnd()
  const u2 = rnd()
  const u3 = rnd()
  const s1 = Math.sqrt(1 - u1)
  const s2 = Math.sqrt(u1)
  const x = s1 * Math.sin(2 * Math.PI * u2)
  const y = s1 * Math.cos(2 * Math.PI * u2)
  const z = s2 * Math.sin(2 * Math.PI * u3)
  const w = s2 * Math.cos(2 * Math.PI * u3)
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
}

/**
 * A camera whose three vanishing points are all comfortably finite. Axes nearly
 * parallel to the image plane throw the VP off to infinity, where the recovery
 * is legitimately ill-conditioned, so we keep away from that.
 */
function randomCamera(rnd: () => number, minAxisZ = 0.25): Camera {
  for (;;) {
    const R = randomRotation(rnd)
    const zs = [0, 1, 2].map((i) => Math.abs(matCol(R, i).z))
    if (Math.min(...zs) < minAxisZ) continue
    return { R, f: 300 + rnd() * 1100, p: { x: (rnd() - 0.5) * 400, y: (rnd() - 0.5) * 400 } }
  }
}

function finiteVPs(cam: Camera): [Vec2, Vec2, Vec2] {
  const vps = vanishingPoints(cam)
  return vps.map((v) => {
    if (v.kind !== 'finite') throw new Error('expected a finite vanishing point')
    return v.at
  }) as [Vec2, Vec2, Vec2]
}

// -- tests --------------------------------------------------------------------

describe('round trip', () => {
  it('recovers p, f and R from the three vanishing points', () => {
    const rnd = mulberry32(0xc0ffee)
    for (let trial = 0; trial < 400; trial++) {
      const cam = randomCamera(rnd)
      const [v1, v2, v3] = finiteVPs(cam)
      const res = recoverCameraFromVPs(v1, v2, v3, cam.R)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      const got = res.camera

      expect(Math.abs(got.f - cam.f)).toBeLessThan(1e-9 * cam.f)
      expect(Math.abs(got.p.x - cam.p.x)).toBeLessThan(1e-9 * cam.f)
      expect(Math.abs(got.p.y - cam.p.y)).toBeLessThan(1e-9 * cam.f)
      expect(matDistance(got.R, cam.R)).toBeLessThan(1e-9)
    }
  })

  it('is stable under the forward map too: recovered camera reproduces the VPs', () => {
    const rnd = mulberry32(7)
    for (let trial = 0; trial < 100; trial++) {
      const cam = randomCamera(rnd)
      const vps = finiteVPs(cam)
      const res = recoverCameraFromVPs(vps[0], vps[1], vps[2], cam.R)
      if (!res.ok) throw new Error('unexpected failure')
      const again = finiteVPs(res.camera)
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(again[i].x - vps[i].x)).toBeLessThan(1e-6 * (1 + Math.abs(vps[i].x)))
        expect(Math.abs(again[i].y - vps[i].y)).toBeLessThan(1e-6 * (1 + Math.abs(vps[i].y)))
      }
    }
  })
})

describe('orthocenter', () => {
  it('satisfies all three altitude equations', () => {
    const rnd = mulberry32(99)
    for (let trial = 0; trial < 300; trial++) {
      const cam = randomCamera(rnd)
      const [v1, v2, v3] = finiteVPs(cam)
      const p = orthocenter(v1, v2, v3)
      expect(p).not.toBeNull()
      if (!p) return
      const scale = Math.max(
        Math.hypot(v1.x - v2.x, v1.y - v2.y),
        Math.hypot(v2.x - v3.x, v2.y - v3.y),
        Math.hypot(v3.x - v1.x, v3.y - v1.y),
      )
      const alt = [
        dot2(sub2(p, v1), sub2(v2, v3)),
        dot2(sub2(p, v2), sub2(v3, v1)),
        dot2(sub2(p, v3), sub2(v1, v2)),
      ]
      for (const a of alt) expect(Math.abs(a)).toBeLessThan(1e-9 * scale * scale)
    }
  })

  it('is the principal point of the generating camera', () => {
    const cam: Camera = { R: matFromEuler(35 * DEG, -32 * DEG, 0), f: 560, p: { x: 12, y: -7 } }
    const [v1, v2, v3] = finiteVPs(cam)
    const p = orthocenter(v1, v2, v3)!
    expect(p.x).toBeCloseTo(12, 8)
    expect(p.y).toBeCloseTo(-7, 8)
  })

  it('returns null for collinear points', () => {
    expect(orthocenter({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 40, y: 40 })).toBeNull()
    expect(orthocenter({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull()
  })
})

describe('orthogonality', () => {
  it('recovered axis directions are mutually orthogonal with det(R) = +1', () => {
    const rnd = mulberry32(1234)
    for (let trial = 0; trial < 300; trial++) {
      const cam = randomCamera(rnd)
      const [v1, v2, v3] = finiteVPs(cam)
      const res = recoverCameraFromVPs(v1, v2, v3, IDENTITY)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      const R = res.camera.R
      const d = [matCol(R, 0), matCol(R, 1), matCol(R, 2)]
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(dot3(d[i], d[i]) - 1)).toBeLessThan(1e-12)
        for (let j = i + 1; j < 3; j++) expect(Math.abs(dot3(d[i], d[j]))).toBeLessThan(1e-12)
      }
      expect(matDet(R)).toBeCloseTo(1, 12)
    }
  })

  it('chooseAxisSigns always yields a right-handed frame', () => {
    const rnd = mulberry32(5150)
    for (let trial = 0; trial < 200; trial++) {
      const cam = randomCamera(rnd)
      const [v1, v2, v3] = finiteVPs(cam)
      const res = recoverCameraFromVPs(v1, v2, v3, randomRotation(rnd))
      if (!res.ok) throw new Error('unexpected failure')
      expect(matDet(res.camera.R)).toBeCloseTo(1, 12)
    }
  })

  it('picks the sign combination nearest the previous frame', () => {
    const d: [
      { x: number; y: number; z: number },
      { x: number; y: number; z: number },
      { x: number; y: number; z: number },
    ] = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ]
    // Previous frame had X and Y flipped; det parity means Z stays put.
    const prev: Mat3 = [-1, 0, 0, 0, -1, 0, 0, 0, 1]
    expect(chooseAxisSigns(d, prev)).toEqual([-1, -1, 1])
    // Only X flipped: parity forces a second flip, on the least committed axis.
    const prev2: Mat3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1]
    const s = chooseAxisSigns(d, prev2)
    expect(s[0] * s[1] * s[2]).toBe(1)
  })
})

describe('rejection of impossible configurations', () => {
  it('reports an obtuse triangle as invalid with f² <= 0, never NaN', () => {
    // Very obtuse: the apex sits almost on the base line.
    const v1 = { x: -400, y: 0 }
    const v2 = { x: 400, y: 0 }
    const v3 = { x: 0, y: 20 }
    const res = recoverCameraFromVPs(v1, v2, v3, IDENTITY)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('nonacute')
    expect(Number.isNaN(res.f2)).toBe(false)
    expect(res.f2).toBeLessThanOrEqual(0)
  })

  it('reports a right triangle as the boundary case', () => {
    const res = recoverCameraFromVPs({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 300 }, IDENTITY)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.f2).toBeCloseTo(0, 9)
  })

  it('reports degenerate (collinear) vanishing points without NaN leaking out', () => {
    const res = recoverCameraFromVPs({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 300, y: 300 }, IDENTITY)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('degenerate')
  })

  it('accepts every acute triangle and refuses every non-acute one', () => {
    const rnd = mulberry32(4242)
    for (let trial = 0; trial < 500; trial++) {
      const pts: [Vec2, Vec2, Vec2] = [
        { x: (rnd() - 0.5) * 2000, y: (rnd() - 0.5) * 2000 },
        { x: (rnd() - 0.5) * 2000, y: (rnd() - 0.5) * 2000 },
        { x: (rnd() - 0.5) * 2000, y: (rnd() - 0.5) * 2000 },
      ]
      const acute = [0, 1, 2].every((i) => {
        const a = pts[i]
        const b = pts[(i + 1) % 3]
        const c = pts[(i + 2) % 3]
        return dot2(sub2(b, a), sub2(c, a)) > 1e-6
      })
      const res = recoverCameraFromVPs(pts[0], pts[1], pts[2], IDENTITY)
      if (acute) expect(res.ok).toBe(true)
      else expect(res.ok).toBe(false)
      if (!res.ok) expect(Number.isNaN(res.f2) && res.reason === 'nonacute').toBe(false)
    }
  })
})

describe('drag clamping', () => {
  it('settles on the last valid point when dragged past the acute boundary', () => {
    const cam: Camera = { R: matFromEuler(35 * DEG, -32 * DEG, 0), f: 560, p: { x: 0, y: 0 } }
    const vps = finiteVPs(cam)
    // Aim vanishing point 0 straight at vanishing point 1: collinear long before
    // it arrives, so the drag must stop short.
    const target = { x: vps[1].x, y: vps[1].y }
    const out = clampVanishingPointDrag(vps, 0, target, cam.R, 20)
    expect(out.clamped).toBe(true)
    expect(out.camera).not.toBeNull()
    expect(Number.isFinite(out.point.x) && Number.isFinite(out.point.y)).toBe(true)
    // The settled point must itself be valid, with the requested margin.
    const check: [Vec2, Vec2, Vec2] = [out.point, vps[1], vps[2]]
    const res = recoverCameraFromVPs(check[0], check[1], check[2], cam.R, 20)
    expect(res.ok).toBe(true)
  })

  it('passes a valid target through untouched', () => {
    const cam: Camera = { R: matFromEuler(35 * DEG, -32 * DEG, 0), f: 560, p: { x: 0, y: 0 } }
    const vps = finiteVPs(cam)
    const target = { x: vps[0].x - 30, y: vps[0].y + 12 }
    const out = clampVanishingPointDrag(vps, 0, target, cam.R, 20)
    expect(out.clamped).toBe(false)
    expect(out.point).toEqual(target)
    expect(out.camera).not.toBeNull()
  })

  it('never produces a NaN camera along a sweep that crosses the boundary', () => {
    const cam: Camera = { R: matFromEuler(35 * DEG, -32 * DEG, 0), f: 560, p: { x: 0, y: 0 } }
    let vps = finiteVPs(cam)
    let R = cam.R
    for (let i = 0; i < 200; i++) {
      const target = { x: vps[0].x + 40, y: vps[0].y + 6 }
      const out = clampVanishingPointDrag(vps, 0, target, R, 20)
      if (out.camera) {
        R = out.camera.R
        expect(Number.isFinite(out.camera.f)).toBe(true)
        expect(Number.isFinite(out.camera.p.x)).toBe(true)
        for (const m of out.camera.R) expect(Number.isFinite(m)).toBe(true)
      }
      vps = [out.point, vps[1], vps[2]]
    }
  })
})

describe('continuity', () => {
  it('never flips a sign of R while a vanishing point walks a path', () => {
    const cam: Camera = { R: matFromEuler(38 * DEG, -30 * DEG, 8 * DEG), f: 620, p: { x: 0, y: 0 } }
    const vps = finiteVPs(cam)
    const radius = 0.12 * cam.f
    // Circle centred so that t = 0 is exactly where the vanishing point starts.
    const centre: Vec2 = { x: vps[0].x - radius, y: vps[0].y }
    let prevR = cam.R
    let maxStep = 0
    for (let i = 1; i <= 720; i++) {
      const t = (i / 720) * Math.PI * 2
      const moved: Vec2 = { x: centre.x + radius * Math.cos(t), y: centre.y + radius * Math.sin(t) }
      const res = recoverCameraFromVPs(moved, vps[1], vps[2], prevR)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      const R = res.camera.R
      // Each axis must stay on the same side of the previous frame's axis.
      for (let axis = 0; axis < 3; axis++) {
        expect(dot3(matCol(R, axis), matCol(prevR, axis))).toBeGreaterThan(0.9)
      }
      maxStep = Math.max(maxStep, matDistance(R, prevR))
      prevR = R
    }
    expect(maxStep).toBeLessThan(0.05)
  })

  it('returns to the starting orientation after a closed loop', () => {
    const cam: Camera = { R: matFromEuler(38 * DEG, -30 * DEG, 8 * DEG), f: 620, p: { x: 0, y: 0 } }
    const vps = finiteVPs(cam)
    const radius = 0.12 * cam.f
    const centre: Vec2 = { x: vps[0].x - radius, y: vps[0].y }
    let prevR = cam.R
    for (let i = 1; i <= 720; i++) {
      const t = (i / 720) * Math.PI * 2
      const moved: Vec2 = { x: centre.x + radius * Math.cos(t), y: centre.y + radius * Math.sin(t) }
      const res = recoverCameraFromVPs(moved, vps[1], vps[2], prevR)
      if (!res.ok) throw new Error('unexpected failure')
      prevR = res.camera.R
    }
    expect(matDistance(prevR, cam.R)).toBeLessThan(1e-8)
  })
})

describe('euler angles', () => {
  it('round-trips through matToEuler', () => {
    const rnd = mulberry32(31337)
    for (let i = 0; i < 200; i++) {
      const yaw = (rnd() - 0.5) * 2 * Math.PI
      const pitch = (rnd() - 0.5) * 0.9 * Math.PI // away from gimbal lock
      const roll = (rnd() - 0.5) * 2 * Math.PI
      const R = matFromEuler(yaw, pitch, roll)
      const e = matToEuler(R)
      expect(matDistance(matFromEuler(e.yaw, e.pitch, e.roll), R)).toBeLessThan(1e-12)
    }
  })
})

describe('limiting cases at infinity', () => {
  it('two-point perspective puts exactly one vanishing point at infinity', () => {
    const cam: Camera = { R: matFromEuler(30 * DEG, 0, 0), f: 600, p: { x: 0, y: 0 } }
    expect(infiniteAxes(cam)).toEqual([1])
    const vp = vanishingPointForAxis(cam, 1)
    expect(vp.kind).toBe('infinite')
  })

  it('sendAxisToInfinity moves the requested axis and only that axis', () => {
    const R = matFromEuler(35 * DEG, -32 * DEG, 11 * DEG)
    const R2 = sendAxisToInfinity(R, 1)!
    expect(Math.abs(matCol(R2, 1).z)).toBeLessThan(1e-12)
    expect(matDet(R2)).toBeCloseTo(1, 12)
    expect(Math.abs(matCol(R2, 0).z)).toBeGreaterThan(1e-6)
    expect(Math.abs(matCol(R2, 2).z)).toBeGreaterThan(1e-6)
  })

  it('sending a second axis to infinity keeps the first one there', () => {
    const R = matFromEuler(35 * DEG, -32 * DEG, 11 * DEG)
    const R2 = sendAxisToInfinity(R, 1)!
    const R3 = sendAxisToInfinity(R2, 0)!
    expect(Math.abs(matCol(R3, 1).z)).toBeLessThan(1e-9)
    expect(Math.abs(matCol(R3, 0).z)).toBeLessThan(1e-9)
    expect(Math.abs(matCol(R3, 2).z)).toBeCloseTo(1, 9)
    expect(matDet(R3)).toBeCloseTo(1, 9)
  })

  it('recovers a camera when one axis is pinned at infinity', () => {
    const cam: Camera = { R: matFromEuler(34 * DEG, 0, 0), f: 640, p: { x: 20, y: -10 } }
    expect(infiniteAxes(cam)).toEqual([1])
    const vA = vanishingPointForAxis(cam, 0)
    const vC = vanishingPointForAxis(cam, 2)
    if (vA.kind !== 'finite' || vC.kind !== 'finite') throw new Error('expected finite')
    // p sits on segment V0 V2; recover using that fraction.
    const t =
      dot2(sub2(cam.p, vA.at), sub2(vC.at, vA.at)) /
      dot2(sub2(vC.at, vA.at), sub2(vC.at, vA.at))
    const res = recoverWithOneAxisAtInfinity(
      { axis: 0, at: vA.at },
      { axis: 2, at: vC.at },
      1,
      t,
      cam.R,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.camera.f).toBeCloseTo(cam.f, 6)
    expect(res.camera.p.x).toBeCloseTo(cam.p.x, 6)
    expect(res.camera.p.y).toBeCloseTo(cam.p.y, 6)
    expect(matDistance(res.camera.R, cam.R)).toBeLessThan(1e-9)
  })
})

describe('screen geometry helpers', () => {
  it('clips a segment against the near plane', () => {
    const a = { x: 0, y: 0, z: -1 }
    const b = { x: 10, y: 0, z: 3 }
    const out = clipSegmentNear(a, b, 1)!
    expect(out[0].z).toBeCloseTo(1, 12)
    expect(out[0].x).toBeCloseTo(5, 12)
    expect(clipSegmentNear({ x: 0, y: 0, z: -3 }, { x: 1, y: 1, z: -1 }, 0.1)).toBeNull()
    expect(clipSegmentNear({ x: 0, y: 0, z: 2 }, { x: 1, y: 1, z: 5 }, 0.1)).not.toBeNull()
  })

  it('builds a convex hull', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 2, y: 2 },
      { x: 1, y: 1 },
    ]
    const hull = convexHull(pts)
    expect(hull).toHaveLength(4)
    for (const h of hull) expect(h.x === 0 || h.x === 4).toBe(true)
  })

  it('finds the two tangent vertices from an external point', () => {
    const hull = convexHull([
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ])
    const idx = tangentIndicesFrom(hull, { x: 10, y: 0 })!
    expect(idx).not.toBeNull()
    const ys = idx.map((i) => hull[i].y).sort()
    expect(ys).toEqual([-1, 1])
    for (const i of idx) expect(hull[i].x).toBe(1)
  })

  it('returns null for a point inside the hull', () => {
    const hull = convexHull([
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ])
    expect(tangentIndicesFrom(hull, { x: 0, y: 0 })).toBeNull()
  })

  it('clips an infinite line to a rectangle', () => {
    const rect = { x0: 0, y0: 0, x1: 10, y1: 10 }
    const out = clipLineToRect({ x: -5, y: 5 }, { x: 15, y: 5 }, rect)!
    expect(out[0].x).toBeCloseTo(0, 12)
    expect(out[1].x).toBeCloseTo(10, 12)
    expect(out[0].y).toBeCloseTo(5, 12)
    const diag = clipLineToRect({ x: -5, y: -5 }, { x: 15, y: 15 }, rect)!
    expect(diag[0].x).toBeCloseTo(0, 12)
    expect(diag[1].x).toBeCloseTo(10, 12)
    expect(clipLineToRect({ x: -5, y: 50 }, { x: 15, y: 50 }, rect)).toBeNull()
  })
})

describe('recoverCameraLenient', () => {
  it('agrees exactly with the strict recovery on an acute triangle', () => {
    const cam: Camera = { R: matFromEuler(35 * DEG, -32 * DEG, 0), f: 560, p: { x: 0, y: 0 } }
    const [v1, v2, v3] = vanishingPoints(cam).map((v) => {
      if (v.kind !== 'finite') throw new Error('expected finite')
      return v.at
    })
    const strict = recoverCameraFromVPs(v1, v2, v3, IDENTITY)
    const lenient = recoverCameraLenient(v1, v2, v3, IDENTITY)
    if (!strict.ok || !lenient) throw new Error('expected both to succeed')
    expect(lenient.valid).toBe(true)
    expect(lenient.camera.f).toBeCloseTo(strict.camera.f, 9)
    expect(matDistance(lenient.camera.R, strict.camera.R)).toBeLessThan(1e-9)
    expect(orthogonalityError(lenient.camera.R)).toBeLessThan(1e-12)
  })

  it('still returns a real, finite camera for an obtuse triangle, but marks it invalid', () => {
    const v1 = { x: -400, y: 0 }
    const v2 = { x: 400, y: 0 }
    const v3 = { x: 0, y: 20 } // apex almost on the base — very obtuse
    const strict = recoverCameraFromVPs(v1, v2, v3, IDENTITY)
    expect(strict.ok).toBe(false)

    const lenient = recoverCameraLenient(v1, v2, v3, IDENTITY)
    expect(lenient).not.toBeNull()
    if (!lenient) return
    expect(lenient.valid).toBe(false)
    expect(Number.isFinite(lenient.camera.f) && lenient.camera.f > 0).toBe(true)
    for (const m of lenient.camera.R) expect(Number.isFinite(m)).toBe(true)
    // The axes it built really are non-orthogonal — this is the whole point.
    expect(orthogonalityError(lenient.camera.R)).toBeGreaterThan(0.1)
  })

  it('reproduces exactly the three vanishing points it was given, valid or not', () => {
    const v1 = { x: -400, y: 0 }
    const v2 = { x: 400, y: 0 }
    const v3 = { x: 0, y: 20 }
    const lenient = recoverCameraLenient(v1, v2, v3, IDENTITY)
    if (!lenient) throw new Error('expected a camera')
    const again = vanishingPoints(lenient.camera).map((v) => {
      if (v.kind !== 'finite') throw new Error('expected finite')
      return v.at
    })
    for (const [got, want] of [
      [again[0], v1],
      [again[1], v2],
      [again[2], v3],
    ] as const) {
      expect(got.x).toBeCloseTo(want.x, 6)
      expect(got.y).toBeCloseTo(want.y, 6)
    }
  })

  it('is continuous through the acute/obtuse boundary, unlike the strict version', () => {
    // v1, v2 fixed; v3 slides straight down. By Thales, the angle at v3 is
    // exactly 90° at y = 300 — obtuse below it, acute above. f from the
    // lenient recovery must not jump crossing that line, even though the
    // strict recovery refuses everything on one side of it.
    const v1 = { x: -300, y: 0 }
    const v2 = { x: 300, y: 0 }
    const below = recoverCameraLenient(v1, v2, { x: 0, y: 299.999 }, IDENTITY)!
    const above = recoverCameraLenient(v1, v2, { x: 0, y: 300.001 }, IDENTITY)!
    expect(below.valid).toBe(false)
    expect(above.valid).toBe(true)
    expect(Math.abs(below.camera.f - above.camera.f)).toBeLessThan(0.01)

    expect(recoverCameraFromVPs(v1, v2, { x: 0, y: 299.999 }, IDENTITY).ok).toBe(false)
    expect(recoverCameraFromVPs(v1, v2, { x: 0, y: 300.001 }, IDENTITY).ok).toBe(true)
  })

  it('returns null only for a genuinely degenerate (collinear) triple', () => {
    expect(recoverCameraLenient({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 300, y: 300 }, IDENTITY)).toBeNull()
  })

  it('stays sign-continuous with the previous frame across the boundary, same as the strict version', () => {
    const cam: Camera = { R: matFromEuler(38 * DEG, -30 * DEG, 8 * DEG), f: 620, p: { x: 0, y: 0 } }
    const vps = vanishingPoints(cam).map((v) => {
      if (v.kind !== 'finite') throw new Error('expected finite')
      return v.at
    })
    let prevR = cam.R
    let flips = 0
    for (let i = 1; i <= 400; i++) {
      const t = (i / 400) * Math.PI * 2
      const moved = { x: vps[0].x + 60 * Math.cos(t), y: vps[0].y + 60 * Math.sin(t) }
      const res = recoverCameraLenient(moved, vps[1], vps[2], prevR)
      if (!res) continue
      for (let axis = 0; axis < 3; axis++) {
        if (dot3(matCol(res.camera.R, axis), matCol(prevR, axis)) < 0) flips++
      }
      prevR = res.camera.R
    }
    expect(flips).toBe(0)
  })
})

describe('orthogonalityError / orthogonalityErrorDegrees', () => {
  it('is zero for any proper rotation', () => {
    const R = matFromEuler(41 * DEG, -17 * DEG, 63 * DEG)
    expect(orthogonalityError(R)).toBeLessThan(1e-12)
    expect(orthogonalityErrorDegrees(R)).toBeCloseTo(0, 6)
  })

  it('grows toward 90° as two axes collapse toward parallel', () => {
    const lenient = recoverCameraLenient({ x: -400, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 5 }, IDENTITY)!
    expect(orthogonalityErrorDegrees(lenient.camera.R)).toBeGreaterThan(orthogonalityErrorDegrees(matFromEuler(0, 0, 0)))
    expect(orthogonalityErrorDegrees(lenient.camera.R)).toBeLessThanOrEqual(90 + 1e-9)
  })
})
