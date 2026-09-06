import { describe, expect, it } from 'vitest'
import { BOX, CONE, CUBE, CYLINDER, L_BLOCK, SHAPES, type ShapeDef } from './shapes'
import { cross3, dot3, norm3, sub3, type Vec3 } from './perspective'

function faceNormal(shape: ShapeDef, face: number[]): Vec3 {
  const a = shape.vertices[face[0]]
  const b = shape.vertices[face[1]]
  const c = shape.vertices[face[2]]
  return norm3(cross3(sub3(b, a), sub3(c, a)))
}

function centroid(points: Vec3[]): Vec3 {
  const s = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }), {
    x: 0,
    y: 0,
    z: 0,
  })
  return { x: s.x / points.length, y: s.y / points.length, z: s.z / points.length }
}

describe('shape definitions', () => {
  it('gives every drawn edge exactly two adjacent faces', () => {
    for (const shape of SHAPES) {
      for (let i = 0; i < shape.edges.length; i++) {
        expect(shape.edgeFaces[i].length, `${shape.id} edge ${i}`).toBe(2)
      }
    }
  })

  it('closes every surface: each face edge is shared by exactly two faces', () => {
    for (const shape of SHAPES) {
      const counts = new Map<string, number>()
      for (const face of shape.faces) {
        for (let i = 0; i < face.length; i++) {
          const a = face[i]
          const b = face[(i + 1) % face.length]
          const key = a < b ? `${a}:${b}` : `${b}:${a}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
      for (const [key, n] of counts) expect(n, `${shape.id} ${key}`).toBe(2)
    }
  })

  it('winds convex solids so face normals point outward', () => {
    for (const shape of [CUBE, BOX, CYLINDER, CONE]) {
      const mid = centroid(shape.vertices)
      for (const face of shape.faces) {
        const n = faceNormal(shape, face)
        const outward = sub3(centroid(face.map((i) => shape.vertices[i])), mid)
        expect(dot3(n, outward), `${shape.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('winds the L-block so every face normal is an outward unit axis', () => {
    // The L-block is not convex, so instead of a centroid test we check that each
    // face normal points away from the solid by sampling just outside the face.
    for (const face of L_BLOCK.faces) {
      const n = faceNormal(L_BLOCK, face)
      const axes = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].filter((c) => c > 1e-9)
      expect(axes).toHaveLength(1)
      const c = centroid(face.map((i) => L_BLOCK.vertices[i]))
      const probe = { x: c.x + n.x * 0.05, y: c.y + n.y * 0.05, z: c.z + n.z * 0.05 }
      expect(insideLBlock(probe)).toBe(false)
      const inner = { x: c.x - n.x * 0.05, y: c.y - n.y * 0.05, z: c.z - n.z * 0.05 }
      expect(insideLBlock(inner)).toBe(true)
    }
  })

  it('tags axis-aligned edges with their axis and leaves curved rims untagged', () => {
    const perAxis = [0, 0, 0]
    for (const e of CUBE.edges) {
      expect(e.axis).toBeGreaterThanOrEqual(0)
      perAxis[e.axis]++
    }
    expect(perAxis).toEqual([4, 4, 4])

    for (const e of L_BLOCK.edges) expect(e.axis).toBeGreaterThanOrEqual(0)
    // Six vertical edges of the L prism run along Y.
    expect(L_BLOCK.edges.filter((e) => e.axis === 1)).toHaveLength(6)

    for (const e of CYLINDER.edges) expect(e.axis).toBe(-1)
  })

  it('groups cylinder rims and the cone apex for silhouette bridging', () => {
    expect(CYLINDER.smooth).toBe(true)
    expect(new Set(CYLINDER.groups).size).toBe(2)
    expect(CYLINDER.groups.filter((g) => g === 0)).toHaveLength(64)
    expect(CONE.smooth).toBe(true)
    expect(CONE.groups.filter((g) => g === 1)).toHaveLength(1)
  })
})

/** Point-in-solid test for the specific L-block above (2x2 square minus the +x/+z quadrant). */
function insideLBlock(p: Vec3): boolean {
  if (p.y < -0.9 || p.y > 0.9) return false
  if (p.x < -1 || p.x > 1 || p.z < -1 || p.z > 1) return false
  return !(p.x > 0 && p.z > 0)
}
