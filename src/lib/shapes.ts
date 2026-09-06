/**
 * Shape data. Adding a shape should be a data change, not a code change:
 * fill in a ShapeDef and put it in the SHAPES array.
 *
 * Conventions: object space is right-handed, roughly bounded by [-1, 1]³, and
 * centred on the origin. Face vertex lists wind counter-clockwise as seen from
 * *outside* the solid, so (v1-v0) x (v2-v0) is the outward normal.
 */

import type { Vec3 } from './perspective'

export interface ShapeEdge {
  a: number
  b: number
  /** 0/1/2 when the edge runs along an object axis (and so owns a vanishing point), -1 otherwise. */
  axis: number
}

export interface ShapeDef {
  id: string
  name: string
  vertices: Vec3[]
  edges: ShapeEdge[]
  /** CCW from outside. */
  faces: number[][]
  /** Faces adjacent to each edge, index-aligned with `edges`. */
  edgeFaces: number[][]
  /**
   * Vertex group ids. For smooth solids, a hull edge joining two different
   * groups is a silhouette line (the sides of a cylinder, the slant of a cone)
   * and gets drawn even though it is not in `edges`.
   */
  groups: number[]
  smooth: boolean
}

const AXIS_TOL = 1e-9

/** Which object axis an edge runs along, or -1 if it is not axis-aligned. */
function inferAxis(a: Vec3, b: Vec3): number {
  const d = [Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)]
  let major = 0
  for (let i = 1; i < 3; i++) if (d[i] > d[major]) major = i
  for (let i = 0; i < 3; i++) if (i !== major && d[i] > AXIS_TOL) return -1
  return d[major] > AXIS_TOL ? major : -1
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

interface ShapeInput {
  id: string
  name: string
  vertices: Vec3[]
  edges: { a: number; b: number }[]
  faces: number[][]
  groups?: number[]
  smooth?: boolean
}

function makeShape(input: ShapeInput): ShapeDef {
  // Walk every face boundary once so each edge learns the faces it borders,
  // even the edges we chose not to draw (cylinder rims border a cap and a quad).
  const adjacency = new Map<string, number[]>()
  input.faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const key = edgeKey(face[i], face[(i + 1) % face.length])
      const list = adjacency.get(key)
      if (list) list.push(fi)
      else adjacency.set(key, [fi])
    }
  })

  return {
    id: input.id,
    name: input.name,
    vertices: input.vertices,
    faces: input.faces,
    smooth: input.smooth ?? false,
    groups: input.groups ?? input.vertices.map(() => 0),
    edges: input.edges.map((e) => ({
      a: e.a,
      b: e.b,
      axis: inferAxis(input.vertices[e.a], input.vertices[e.b]),
    })),
    edgeFaces: input.edges.map((e) => adjacency.get(edgeKey(e.a, e.b)) ?? []),
  }
}

// ---------------------------------------------------------------------------
// Prisms: extrude a polygon in the XZ plane along Y.
// ---------------------------------------------------------------------------

interface P2 {
  x: number
  z: number
}

/**
 * `poly` must wind CLOCKWISE in the (x, z) plane; that is what makes the top
 * cap's outward normal come out as +Y under the right-hand rule.
 */
function extrude(
  id: string,
  name: string,
  poly: P2[],
  yBottom: number,
  yTop: number,
  opts: { sideEdges?: boolean; groupRims?: boolean; smooth?: boolean } = {},
): ShapeDef {
  const n = poly.length
  const vertices: Vec3[] = [
    ...poly.map((p) => ({ x: p.x, y: yBottom, z: p.z })),
    ...poly.map((p) => ({ x: p.x, y: yTop, z: p.z })),
  ]

  const faces: number[][] = []
  // Top cap keeps the polygon order; bottom cap is reversed so it faces -Y.
  faces.push(Array.from({ length: n }, (_, i) => n + i))
  faces.push(Array.from({ length: n }, (_, i) => n - 1 - i))
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    faces.push([i, j, n + j, n + i])
  }

  const edges: { a: number; b: number }[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    edges.push({ a: i, b: j })
    edges.push({ a: n + i, b: n + j })
  }
  if (opts.sideEdges ?? true) {
    for (let i = 0; i < n; i++) edges.push({ a: i, b: n + i })
  }

  const groups = opts.groupRims
    ? vertices.map((_, i) => (i < n ? 0 : 1))
    : vertices.map(() => 0)

  return makeShape({ id, name, vertices, edges, faces, groups, smooth: opts.smooth })
}

function rectangle(hx: number, hz: number): P2[] {
  // Clockwise in (x, z).
  return [
    { x: -hx, z: -hz },
    { x: -hx, z: hz },
    { x: hx, z: hz },
    { x: hx, z: -hz },
  ]
}

function circle(radius: number, segments: number): P2[] {
  const out: P2[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    // Negated z so the ring winds clockwise in (x, z).
    out.push({ x: radius * Math.cos(t), z: -radius * Math.sin(t) })
  }
  return out
}

function cone(id: string, name: string, radius: number, segments: number, yBottom: number, yTop: number): ShapeDef {
  const base = circle(radius, segments)
  const vertices: Vec3[] = [
    ...base.map((p) => ({ x: p.x, y: yBottom, z: p.z })),
    { x: 0, y: yTop, z: 0 },
  ]
  const apex = segments
  const faces: number[][] = [Array.from({ length: segments }, (_, i) => segments - 1 - i)]
  for (let i = 0; i < segments; i++) faces.push([i, (i + 1) % segments, apex])

  const edges: { a: number; b: number }[] = []
  for (let i = 0; i < segments; i++) edges.push({ a: i, b: (i + 1) % segments })

  const groups = vertices.map((_, i) => (i === apex ? 1 : 0))
  return makeShape({ id, name, vertices, edges, faces, groups, smooth: true })
}

// ---------------------------------------------------------------------------

export const CUBE = extrude('cube', 'Cube', rectangle(1, 1), -1, 1)

export const BOX = extrude('box', 'Box', rectangle(1.35, 0.75), -0.55, 0.55)

/**
 * An L-shaped prism. The most instructive of the set: it has coplanar edge
 * groups running to all three vanishing points, including two separate faces
 * whose edges share a direction.
 */
export const L_BLOCK = extrude(
  'lblock',
  'L-block',
  // Clockwise in (x, z): a 2x2 square with the (+x, +z) quadrant bitten out.
  [
    { x: -1, z: -1 },
    { x: -1, z: 1 },
    { x: 0, z: 1 },
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: -1 },
  ],
  -0.9,
  0.9,
)

export const CYLINDER = extrude('cylinder', 'Cylinder', circle(0.9, 64), -1, 1, {
  sideEdges: false,
  groupRims: true,
  smooth: true,
})

export const CONE = cone('cone', 'Cone', 1, 64, -1, 1.1)

export const SHAPES: ShapeDef[] = [CUBE, BOX, L_BLOCK, CYLINDER, CONE]

export const shapeById = (id: string): ShapeDef => SHAPES.find((s) => s.id === id) ?? CUBE
