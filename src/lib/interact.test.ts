import { describe, expect, it } from 'vitest'
import {
  type Camera,
  type Vec2,
  DEG,
  dist2,
  infiniteAxes,
  matCol,
  matDet,
  matDistance,
  matFromEuler,
  vanishingPointForAxis,
} from './perspective'
import {
  contentBounds,
  dragVanishingPoint,
  fitViewport,
  trackballRotate,
} from './interact'
import { bringAxisBackFromInfinity, sendAxisToInfinity } from './perspective'

const threePoint: Camera = {
  R: matFromEuler(35 * DEG, -32 * DEG, 0),
  f: 560,
  p: { x: 0, y: 0 },
}

const finiteVp = (cam: Camera, axis: number): Vec2 => {
  const v = vanishingPointForAxis(cam, axis)
  if (v.kind !== 'finite') throw new Error(`axis ${axis} is at infinity`)
  return v.at
}

describe('dragging with three finite vanishing points', () => {
  it('lands the dragged vanishing point on the target', () => {
    const target = { x: 500, y: -600 }
    const out = dragVanishingPoint(threePoint, 2, target)
    expect(out.refused).toBe(false)
    expect(out.invalid).toBe(false)
    const moved = finiteVp(out.camera, 2)
    expect(moved.x).toBeCloseTo(target.x, 6)
    expect(moved.y).toBeCloseTo(target.y, 6)
  })

  it('leaves the other two vanishing points exactly where they were', () => {
    const before = [0, 1, 2].map((i) => finiteVp(threePoint, i))
    const out = dragVanishingPoint(threePoint, 2, { x: 500, y: -600 })
    for (const axis of [0, 1]) {
      const after = finiteVp(out.camera, axis)
      expect(after.x).toBeCloseTo(before[axis].x, 6)
      expect(after.y).toBeCloseTo(before[axis].y, 6)
    }
  })

  it('really changes the camera rather than distorting the drawing', () => {
    const out = dragVanishingPoint(threePoint, 2, { x: 500, y: -600 })
    expect(matDistance(out.camera.R, threePoint.R)).toBeGreaterThan(0.05)
    expect(matDet(out.camera.R)).toBeCloseTo(1, 12)
    expect(out.camera.f).not.toBeCloseTo(threePoint.f, 3)
  })

  it('lands exactly on an obtuse target instead of stopping short, and flags it invalid', () => {
    const v0 = finiteVp(threePoint, 0)
    const v1 = finiteVp(threePoint, 1)
    // Push vanishing point 2 far along the extension of the v0-v1 segment,
    // offset just enough to stay non-collinear: a real, very obtuse triangle.
    const dx = v1.x - v0.x
    const dy = v1.y - v0.y
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    const target = { x: v1.x + ux * 500 - uy * 40, y: v1.y + uy * 500 + ux * 40 }

    const out = dragVanishingPoint(threePoint, 2, target)
    expect(out.refused).toBe(false)
    expect(out.invalid).toBe(true)
    const moved = finiteVp(out.camera, 2)
    expect(moved.x).toBeCloseTo(target.x, 6)
    expect(moved.y).toBeCloseTo(target.y, 6)
    // Still a real, finite, drawable camera — just not an orthogonal one.
    expect(Number.isFinite(out.camera.f) && out.camera.f > 0).toBe(true)
    for (const m of out.camera.R) expect(Number.isFinite(m)).toBe(true)
  })

  it('refuses a target that would make two vanishing points coincide', () => {
    // Drag vanishing point 2 exactly onto vanishing point 0: zero-area triangle.
    const out = dragVanishingPoint(threePoint, 2, finiteVp(threePoint, 0))
    expect(out.refused).toBe(true)
    expect(out.camera).toEqual(threePoint)
  })

  it('recovers cleanly once dragged back into an acute configuration', () => {
    const v0 = finiteVp(threePoint, 0)
    const v1 = finiteVp(threePoint, 1)
    const dx = v1.x - v0.x
    const dy = v1.y - v0.y
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    const obtuseTarget = { x: v1.x + ux * 500 - uy * 40, y: v1.y + uy * 500 + ux * 40 }
    const bent = dragVanishingPoint(threePoint, 2, obtuseTarget)
    expect(bent.invalid).toBe(true)

    const restored = dragVanishingPoint(bent.camera, 2, finiteVp(threePoint, 2))
    expect(restored.invalid).toBe(false)
    expect(matDet(restored.camera.R)).toBeCloseTo(1, 8)
  })

  it('survives a long sweep across the boundary, staying real and never NaN', () => {
    let cam = threePoint
    for (let i = 0; i < 300; i++) {
      const vp = finiteVp(cam, 2)
      const out = dragVanishingPoint(cam, 2, { x: vp.x - 35, y: vp.y + 25 })
      cam = out.camera
      expect(Number.isFinite(cam.f) && cam.f > 0).toBe(true)
      for (const m of cam.R) expect(Number.isFinite(m)).toBe(true)
    }
  })
})

describe('dragging with one vanishing point at infinity', () => {
  const twoPoint: Camera = { R: matFromEuler(32 * DEG, 0, 0), f: 640, p: { x: 0, y: 0 } }

  it('starts from a genuine two-point configuration', () => {
    expect(infiniteAxes(twoPoint)).toEqual([1])
  })

  it('keeps the vertical axis at infinity while a finite one is dragged', () => {
    const out = dragVanishingPoint(twoPoint, 0, { x: -1400, y: 120 })
    expect(infiniteAxes(out.camera)).toEqual([1])
    expect(matDet(out.camera.R)).toBeCloseTo(1, 10)
  })

  it('lands the dragged vanishing point on the target', () => {
    const target = { x: -1400, y: 120 }
    const out = dragVanishingPoint(twoPoint, 0, target)
    const moved = finiteVp(out.camera, 0)
    expect(moved.x).toBeCloseTo(target.x, 5)
    expect(moved.y).toBeCloseTo(target.y, 5)
  })

  it('keeps the principal point on the line joining the two finite points', () => {
    const out = dragVanishingPoint(twoPoint, 0, { x: -1400, y: 120 })
    const a = finiteVp(out.camera, 0)
    const b = finiteVp(out.camera, 2)
    const p = out.camera.p
    // Collinear: the cross product of (p-a) and (b-a) vanishes.
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)
    expect(Math.abs(cross)).toBeLessThan(1e-6 * dist2(a, b) * dist2(a, b))
    // ...and strictly between them, which is what keeps f real.
    expect(Math.min(a.x, b.x)).toBeLessThan(p.x)
    expect(p.x).toBeLessThan(Math.max(a.x, b.x))
  })

  it('refuses to collapse the two finite points onto each other', () => {
    const other = finiteVp(twoPoint, 2)
    const out = dragVanishingPoint(twoPoint, 0, other)
    expect(out.refused).toBe(true)
    expect(out.camera.f).toBeGreaterThan(0)
    expect(Number.isFinite(out.camera.f)).toBe(true)
  })
})

describe('dragging with two vanishing points at infinity', () => {
  const onePoint: Camera = { R: matFromEuler(0, 0, 0), f: 700, p: { x: 0, y: 0 } }

  it('is a genuine one-point configuration: the vanishing point is the principal point', () => {
    expect(infiniteAxes(onePoint)).toEqual([0, 1])
    const vp = finiteVp(onePoint, 2)
    expect(vp.x).toBeCloseTo(onePoint.p.x, 12)
    expect(vp.y).toBeCloseTo(onePoint.p.y, 12)
  })

  it('slides the picture plane and leaves the focal length free', () => {
    const out = dragVanishingPoint(onePoint, 2, { x: 210, y: -90 })
    expect(out.camera.p.x).toBeCloseTo(210, 12)
    expect(out.camera.p.y).toBeCloseTo(-90, 12)
    expect(out.camera.f).toBe(onePoint.f)
    expect(matDistance(out.camera.R, onePoint.R)).toBeLessThan(1e-12)
    expect(finiteVp(out.camera, 2).x).toBeCloseTo(210, 10)
  })
})

describe('dragging a vanishing point that is itself at infinity', () => {
  const twoPoint: Camera = { R: matFromEuler(32 * DEG, 0, 0), f: 640, p: { x: 0, y: 0 } }

  it('turns the parallel family to point at the cursor, staying at infinity', () => {
    const target = { x: 300, y: 300 } // 45° below-right of the principal point
    const out = dragVanishingPoint(twoPoint, 1, target)
    expect(infiniteAxes(out.camera)).toEqual([1])
    const vp = vanishingPointForAxis(out.camera, 1)
    if (vp.kind !== 'infinite') throw new Error('expected infinite')
    const angle = Math.atan2(vp.dir.y, vp.dir.x)
    expect(Math.abs(angle - Math.PI / 4)).toBeLessThan(1e-9)
    expect(matDet(out.camera.R)).toBeCloseTo(1, 12)
  })

  it('is a pure roll: it does not change the focal length or principal point', () => {
    const out = dragVanishingPoint(twoPoint, 1, { x: 300, y: 300 })
    expect(out.camera.f).toBe(twoPoint.f)
    expect(out.camera.p).toEqual(twoPoint.p)
  })
})

describe('object rotation moves the vanishing points', () => {
  it('tracks the other direction: turning the object relocates every vanishing point', () => {
    const before = [0, 1, 2].map((i) => finiteVp(threePoint, i))
    const turned: Camera = { ...threePoint, R: trackballRotate(threePoint.R, 40, -25) }
    const after = [0, 1, 2].map((i) => finiteVp(turned, i))
    for (let i = 0; i < 3; i++) expect(dist2(before[i], after[i])).toBeGreaterThan(1)
    // The principal point is a property of the camera, not the object, so it stays.
    expect(turned.p).toEqual(threePoint.p)
  })

  it('keeps R orthonormal over many small rotations', () => {
    let R = threePoint.R
    for (let i = 0; i < 2000; i++) R = trackballRotate(R, 3, -2)
    expect(matDet(R)).toBeCloseTo(1, 10)
    for (let i = 0; i < 3; i++) {
      const c = matCol(R, i)
      expect(Math.hypot(c.x, c.y, c.z)).toBeCloseTo(1, 10)
    }
  })
})

describe('changing the focal length', () => {
  it('scales the vanishing points radially about the principal point', () => {
    const p = threePoint.p
    const before = [0, 1, 2].map((i) => finiteVp(threePoint, i))
    const zoomed: Camera = { ...threePoint, f: threePoint.f * 2 }
    const after = [0, 1, 2].map((i) => finiteVp(zoomed, i))
    for (let i = 0; i < 3; i++) {
      expect(after[i].x - p.x).toBeCloseTo((before[i].x - p.x) * 2, 8)
      expect(after[i].y - p.y).toBeCloseTo((before[i].y - p.y) * 2, 8)
    }
  })
})

describe('panning the picture plane', () => {
  it('translates the vanishing-point triangle rigidly', () => {
    const before = [0, 1, 2].map((i) => finiteVp(threePoint, i))
    const panned: Camera = { ...threePoint, p: { x: 130, y: -70 } }
    const after = [0, 1, 2].map((i) => finiteVp(panned, i))
    for (let i = 0; i < 3; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(130, 8)
      expect(after[i].y - before[i].y).toBeCloseTo(-70, 8)
    }
  })
})

describe('viewport fitting', () => {
  it('encloses the picture plane and every finite vanishing point', () => {
    const frame = { w: 760, h: 520 }
    const b = contentBounds(threePoint, frame)
    for (let i = 0; i < 3; i++) {
      const vp = finiteVp(threePoint, i)
      expect(vp.x).toBeGreaterThanOrEqual(b.x0)
      expect(vp.x).toBeLessThanOrEqual(b.x1)
      expect(vp.y).toBeGreaterThanOrEqual(b.y0)
      expect(vp.y).toBeLessThanOrEqual(b.y1)
    }
    const view = fitViewport(b, 1200, 800)
    const sx = (x: number) => x * view.zoom + view.tx
    const sy = (y: number) => y * view.zoom + view.ty
    for (let i = 0; i < 3; i++) {
      const vp = finiteVp(threePoint, i)
      expect(sx(vp.x)).toBeGreaterThan(0)
      expect(sx(vp.x)).toBeLessThan(1200)
      expect(sy(vp.y)).toBeGreaterThan(0)
      expect(sy(vp.y)).toBeLessThan(800)
    }
  })

  it('ignores a vanishing point that has run off toward infinity', () => {
    // Axis 1 a hair off parallel with the picture plane: finite, but very far.
    const R = bringAxisBackFromInfinity(sendAxisToInfinity(threePoint.R, 1)!, 1, 0.0004)
    const cam: Camera = { ...threePoint, R }
    const far = finiteVp(cam, 1)
    expect(dist2(far, cam.p)).toBeGreaterThan(40 * cam.f)
    const b = contentBounds(cam, { w: 760, h: 520 })
    // The runaway point is excluded, so the picture plane still fills the view.
    expect(b.x1 - b.x0).toBeLessThan(40 * cam.f)
    expect(b.y1 - b.y0).toBeLessThan(40 * cam.f)
    const view = fitViewport(b, 1200, 800)
    expect(760 * view.zoom).toBeGreaterThan(80)
  })

  it('ignores vanishing points at infinity instead of blowing up', () => {
    const R = sendAxisToInfinity(threePoint.R, 1)!
    const b = contentBounds({ ...threePoint, R }, { w: 760, h: 520 })
    for (const v of [b.x0, b.y0, b.x1, b.y1]) expect(Number.isFinite(v)).toBe(true)
    const view = fitViewport(b, 1200, 800)
    expect(view.zoom).toBeGreaterThan(0)
    expect(Number.isFinite(view.tx)).toBe(true)
  })
})
