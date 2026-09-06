import type { Camera, VanishingPoint } from '../lib/perspective'
import { SHAPES } from '../lib/shapes'
import { AXIS_LABELS, type Toggles } from '../render/draw'
import { THEME } from '../render/theme'
import { FOCAL_MAX, FOCAL_MIN, PRESETS, focalToSlider, sliderToFocal } from '../lib/presets'

export interface ControlsProps {
  camera: Camera
  vps: readonly VanishingPoint[]
  euler: { yaw: number; pitch: number; roll: number }
  shapeId: string
  scale: number
  depth: number
  toggles: Toggles
  activePreset: string | null
  onFocal: (f: number) => void
  onEuler: (e: { yaw: number; pitch: number; roll: number }) => void
  onShape: (id: string) => void
  onScale: (n: number) => void
  onDepth: (n: number) => void
  onToggle: (key: keyof Toggles) => void
  onPreset: (id: string) => void
  onReset: () => void
  onFitAll: () => void
  onToggleInfinity: (axis: number) => void
}

const TOGGLE_LABELS: [keyof Toggles, string][] = [
  ['convergence', 'Convergence lines'],
  ['tangents', 'Tangent lines'],
  ['grid', 'Background grid'],
  ['groundGrid', 'Perspective ground'],
  ['hiddenLines', 'Hidden-line removal'],
  ['shaded', 'Shaded faces'],
  ['altitudes', 'Altitudes / orthocenter'],
  ['labels', 'Labels'],
]

const fmt = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toFixed(digits) : '—'

export function Controls(props: ControlsProps) {
  const { camera, vps, euler, toggles } = props
  const deg = (r: number) => Math.round((r * 180) / Math.PI * 10) / 10

  return (
    <aside className="panel">
      <header className="panel-head">
        <h1>Perspective</h1>
        <p>Three vanishing points, one camera.</p>
      </header>

      <section>
        <h2>Camera</h2>

        <label className="slider">
          <span className="slider-label">
            Focal length
            <b>{fmt(camera.f, 0)} px</b>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={focalToSlider(camera.f)}
            onChange={(e) => props.onFocal(sliderToFocal(Number(e.target.value)))}
          />
          <span className="slider-ends">
            <i>{FOCAL_MIN}</i>
            <i>{FOCAL_MAX}</i>
          </span>
        </label>

        <div className="readout">
          <span>Principal point</span>
          <b>
            {fmt(camera.p.x)}, {fmt(camera.p.y)}
          </b>
        </div>

        {[0, 1, 2].map((axis) => {
          const vp = vps[axis]
          const atInfinity = vp.kind === 'infinite'
          return (
            <div className="readout vp" key={axis}>
              <span>
                <i className="swatch" style={{ background: THEME.axis[axis] }} />
                VP {AXIS_LABELS[axis]}
              </span>
              <b>
                {atInfinity
                  ? `∞ @ ${fmt((Math.atan2(vp.dir.y, vp.dir.x) * 180) / Math.PI, 0)}°`
                  : `${fmt(vp.at.x)}, ${fmt(vp.at.y)}`}
              </b>
              <button
                type="button"
                className={`inf ${atInfinity ? 'on' : ''}`}
                title={atInfinity ? 'Bring this vanishing point back from infinity' : 'Send this vanishing point to infinity'}
                onClick={() => props.onToggleInfinity(axis)}
              >
                ∞
              </button>
            </div>
          )
        })}

        <div className="row-buttons">
          <button type="button" onClick={props.onFitAll}>
            Fit all vanishing points
          </button>
        </div>
      </section>

      <section>
        <h2>Object</h2>
        <label className="picker">
          <span>Shape</span>
          <select value={props.shapeId} onChange={(e) => props.onShape(e.target.value)}>
            {SHAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="slider">
          <span className="slider-label">
            Scale<b>{fmt(props.scale, 2)}</b>
          </span>
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.01}
            value={props.scale}
            onChange={(e) => props.onScale(Number(e.target.value))}
          />
        </label>

        <label className="slider">
          <span className="slider-label">
            Depth<b>{fmt(props.depth, 2)}</b>
          </span>
          <input
            type="range"
            min={1.5}
            max={24}
            step={0.05}
            value={props.depth}
            onChange={(e) => props.onDepth(Number(e.target.value))}
          />
        </label>

        <div className="angles">
          {(['yaw', 'pitch', 'roll'] as const).map((key) => (
            <label key={key}>
              <span>{key}</span>
              <input
                type="number"
                step={1}
                value={deg(euler[key])}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  props.onEuler({ ...euler, [key]: (v * Math.PI) / 180 })
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>Presets</h2>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              className={props.activePreset === p.id ? 'on' : ''}
              title={p.hint}
              onClick={() => props.onPreset(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="row-buttons">
          <button type="button" onClick={props.onReset}>
            Reset
          </button>
        </div>
      </section>

      <section>
        <h2>Layers</h2>
        <ul className="toggles">
          {TOGGLE_LABELS.map(([key, label]) => (
            <li key={key}>
              <label>
                <input
                  type="checkbox"
                  checked={toggles[key]}
                  onChange={() => props.onToggle(key)}
                />
                <span>{label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <footer className="panel-foot">
        <p>Drag a vanishing point to move the camera. Drag the object to turn it.</p>
        <p>Shift-drag the object to reposition it; drag the frame edge to pan the picture plane. Scroll to zoom.</p>
      </footer>
    </aside>
  )
}
