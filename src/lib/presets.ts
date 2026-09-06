import { type Camera, DEG, matFromEuler, type Vec2 } from './perspective'
import type { Toggles } from '../render/draw'

/** The notional picture plane, in frame pixels. Always centred on p. */
export const FRAME = { w: 760, h: 520 }

export interface Preset {
  id: string
  name: string
  hint: string
  camera: Camera
  anchorOffset: Vec2
  /** Overrides the object depth, where the preset reads better at a different one. */
  depth?: number
}

const cam = (yaw: number, pitch: number, roll: number, f: number): Camera => ({
  R: matFromEuler(yaw * DEG, pitch * DEG, roll * DEG),
  f,
  p: { x: 0, y: 0 },
})

export const PRESETS: Preset[] = [
  {
    id: 'one',
    name: 'One-point',
    hint: 'X and Y run parallel to the picture plane, so only Z has a finite vanishing point — and it lands exactly on the principal point.',
    camera: cam(0, 0, 0, 700),
    anchorOffset: { x: -170, y: 40 },
    depth: 8,
  },
  {
    id: 'two',
    name: 'Two-point',
    hint: 'The vertical axis stays parallel to the picture plane; its vanishing point is at infinity and vertical edges stay vertical.',
    camera: cam(32, 0, 0, 640),
    anchorOffset: { x: 0, y: 30 },
    depth: 5.5,
  },
  {
    id: 'worm',
    name: "Worm's eye",
    hint: 'Camera tilted up: the vertical vanishing point climbs above the frame and verticals splay outward as they rise.',
    camera: cam(35, 32, 0, 560),
    anchorOffset: { x: 0, y: 0 },
  },
  {
    id: 'bird',
    name: "Bird's eye",
    hint: 'Camera tilted down: the vertical vanishing point drops below the frame and verticals converge downward.',
    camera: cam(35, -32, 0, 560),
    anchorOffset: { x: 0, y: 0 },
  },
]

export const DEFAULT_PRESET = PRESETS[3]

export const DEFAULT_TOGGLES: Toggles = {
  convergence: true,
  tangents: false,
  grid: true,
  groundGrid: false,
  hiddenLines: true,
  shaded: false,
  altitudes: true,
  labels: true,
  frame: true,
}

export const DEFAULTS = {
  shapeId: 'cube',
  scale: 1.15,
  depth: 4.5,
}

export const FOCAL_MIN = 60
export const FOCAL_MAX = 4000

/** The focal slider is logarithmic; wide-angle deserves as much travel as tele. */
export const focalToSlider = (f: number): number =>
  (Math.log(Math.min(FOCAL_MAX, Math.max(FOCAL_MIN, f))) - Math.log(FOCAL_MIN)) /
  (Math.log(FOCAL_MAX) - Math.log(FOCAL_MIN))

export const sliderToFocal = (t: number): number =>
  Math.exp(Math.log(FOCAL_MIN) + t * (Math.log(FOCAL_MAX) - Math.log(FOCAL_MIN)))
