/**
 * Turns { camera, shape, placement } into everything the renderer needs, in
 * frame-pixel coordinates. Pure: no canvas, no React.
 */

import {
  type Camera,
  type Vec2,
  type Vec3,
  type VanishingPoint,
  centerFromAnchor,
  clipPolygonNear,
  clipSegmentNear,
  convexHullIndices,
  dot3,
  matMulVec,
  newellNormal,
  norm3,
  objectToCamera,
  projectCamera,
  vanishingPoints,
} from './perspective'
import type { ShapeDef } from './shapes'

export interface SceneVertex {
  cam: Vec3
  screen: Vec2
  /** In front of the near plane, so `screen` is meaningful. */
  ok: boolean
}

export interface SceneEdge {
  axis: number
  hidden: boolean
  /** Already clipped against the near plane; null when entirely behind it. */
  seg: [Vec2, Vec2] | null
}

export interface SceneFace {
  poly: Vec2[]
  front: boolean
  shade: number
  /** Depth of the face centroid, for painter ordering. */
  depth: number
}

export interface Scene {
  center: Vec3
  near: number
  vertices: SceneVertex[]
  edges: SceneEdge[]
  faces: SceneFace[]
  /** Convex hull of the projected silhouette, frame pixels. */
  hull: Vec2[]
  /** Side lines of smooth solids (cylinder walls, cone slant). */
  silhouette: [Vec2, Vec2][]
  vps: [VanishingPoint, VanishingPoint, VanishingPoint]
}

export interface Placement {
  scale: number
  depth: number
  /** Where the object's centre should land on the image, in frame pixels. */
  anchor: Vec2
}

/**
 * Direction from a surface *toward* the light, in camera space: over the
 * viewer's left shoulder, so -z points it back out of the screen at the object.
 */
const LIGHT = norm3({ x: -0.40, y: 0.72, z: -0.57 })
const AMBIENT = 0.26

export function buildScene(camera: Camera, shape: ShapeDef, placement: Placement): Scene {
  const { scale, depth, anchor } = placement
  const near = 0.01 * depth
  const center = centerFromAnchor(camera, anchor, depth)

  const vertices: SceneVertex[] = shape.vertices.map((v) => {
    const cam = objectToCamera(camera.R, scale, v, center)
    const ok = cam.z >= near
    return { cam, ok, screen: ok ? projectCamera(camera, cam) : { x: 0, y: 0 } }
  })

  // --- faces: normal, facing, flat lambert -------------------------------
  const faceFront: boolean[] = []
  const faces: SceneFace[] = []
  for (const face of shape.faces) {
    const poly3 = face.map((i) => vertices[i].cam)
    const n = newellNormal(poly3)
    let cx = 0
    let cy = 0
    let cz = 0
    for (const p of poly3) {
      cx += p.x
      cy += p.y
      cz += p.z
    }
    const inv = 1 / poly3.length
    const centroid: Vec3 = { x: cx * inv, y: cy * inv, z: cz * inv }
    // Camera sits at the origin looking down +z, so a face is visible when its
    // outward normal leans back toward the origin.
    const front = dot3(n, centroid) < 0
    faceFront.push(front)

    const clipped = clipPolygonNear(poly3, near)
    faces.push({
      poly: clipped.length >= 3 ? clipped.map((p) => projectCamera(camera, p)) : [],
      front,
      shade: Math.min(1, AMBIENT + (1 - AMBIENT) * Math.max(0, dot3(n, LIGHT))),
      depth: centroid.z,
    })
  }
  // Painter's algorithm, far to near. Fine for these convex-ish solids.
  faces.sort((a, b) => b.depth - a.depth)

  // --- edges: near clip + hidden-line removal ----------------------------
  const edges: SceneEdge[] = shape.edges.map((e, i) => {
    const clipped = clipSegmentNear(vertices[e.a].cam, vertices[e.b].cam, near)
    const adjacent = shape.edgeFaces[i]
    // An edge of a convex solid is hidden when both faces meeting there point away.
    const hidden = adjacent.length === 2 && !faceFront[adjacent[0]] && !faceFront[adjacent[1]]
    return {
      axis: e.axis,
      hidden,
      seg: clipped ? [projectCamera(camera, clipped[0]), projectCamera(camera, clipped[1])] : null,
    }
  })

  // --- silhouette ---------------------------------------------------------
  const visibleIdx: number[] = []
  for (let i = 0; i < vertices.length; i++) if (vertices[i].ok) visibleIdx.push(i)
  const pts = visibleIdx.map((i) => vertices[i].screen)
  const hullLocal = convexHullIndices(pts)
  const hullIdx = hullLocal.map((i) => visibleIdx[i])
  const hull = hullIdx.map((i) => vertices[i].screen)

  const silhouette: [Vec2, Vec2][] = []
  if (shape.smooth && hullIdx.length >= 2) {
    // On a smooth solid the drawn edges only cover the rims; the sides are
    // wherever the hull steps from one rim to the other.
    for (let i = 0; i < hullIdx.length; i++) {
      const a = hullIdx[i]
      const b = hullIdx[(i + 1) % hullIdx.length]
      if (shape.groups[a] !== shape.groups[b]) {
        silhouette.push([vertices[a].screen, vertices[b].screen])
      }
    }
  }

  return {
    center,
    near,
    vertices,
    edges,
    faces,
    hull,
    silhouette,
    vps: vanishingPoints(camera),
  }
}

// ---------------------------------------------------------------------------
// Perspective ground grid, ruled along the object's X and Z axes.
// ---------------------------------------------------------------------------

export function groundGridSegments(
  camera: Camera,
  placement: Placement,
  half = 6,
  step = 1,
): [Vec2, Vec2][] {
  const near = 0.01 * placement.depth
  const center = centerFromAnchor(camera, placement.anchor, placement.depth)
  const y = -1.02 // just below the unit-ish shapes
  const out: [Vec2, Vec2][] = []

  const toCam = (x: number, z: number): Vec3 => {
    const s = matMulVec(camera.R, {
      x: x * placement.scale,
      y: y * placement.scale,
      z: z * placement.scale,
    })
    return { x: s.x + center.x, y: s.y + center.y, z: s.z + center.z }
  }

  const extent = half * step
  for (let i = -half; i <= half; i++) {
    const t = i * step
    for (const [a, b] of [
      [toCam(t, -extent), toCam(t, extent)],
      [toCam(-extent, t), toCam(extent, t)],
    ] as [Vec3, Vec3][]) {
      const clipped = clipSegmentNear(a, b, near)
      if (clipped) out.push([projectCamera(camera, clipped[0]), projectCamera(camera, clipped[1])])
    }
  }
  return out
}
