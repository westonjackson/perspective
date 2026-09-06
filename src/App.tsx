import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type Camera,
  type Vec2,
  add2,
  bringAxisBackFromInfinity,
  infiniteAxes,
  matFromEuler,
  matToEuler,
  pointInConvexPolygon,
  sendAxisToInfinity,
  sub2,
  vanishingPoints,
} from './lib/perspective'
import { buildScene, groundGridSegments } from './lib/scene'
import { shapeById } from './lib/shapes'
import {
  contentBounds,
  dragVanishingPoint,
  fitViewport,
  trackballRotate,
} from './lib/interact'
import {
  DEFAULTS,
  DEFAULT_PRESET,
  DEFAULT_TOGGLES,
  FRAME,
  PRESETS,
} from './lib/presets'
import {
  HANDLE_HIT_RADIUS,
  type Toggles,
  type Viewport,
  draw,
  handleScreenPosition,
  toFrame,
  toScreen,
} from './render/draw'
import { Controls } from './ui/Controls'
import './styles.css'

type Drag =
  | { kind: 'vp'; axis: number; grab: Vec2 }
  | { kind: 'rotate'; last: Vec2 }
  | { kind: 'anchor'; grab: Vec2 }
  | { kind: 'frame'; grab: Vec2 }
  | { kind: 'pan'; last: Vec2 }

const NONACUTE_HINT =
  'Three vanishing points only describe a real camera when their triangle is acute. Stopped at the boundary.'
const DEGENERATE_HINT =
  'Three vanishing points cannot be collinear — that would put the camera nowhere.'

const FRAME_BORDER_TOL = 9

export default function App() {
  const [camera, setCamera] = useState<Camera>(DEFAULT_PRESET.camera)
  const [anchorOffset, setAnchorOffset] = useState<Vec2>(DEFAULT_PRESET.anchorOffset)
  const [shapeId, setShapeId] = useState(DEFAULTS.shapeId)
  const [scale, setScale] = useState(DEFAULTS.scale)
  const [depth, setDepth] = useState(DEFAULTS.depth)
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES)
  const [view, setView] = useState<Viewport>({ zoom: 1, tx: 0, ty: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<number | null>(null)
  const [activeHandle, setActiveHandle] = useState<number | null>(null)
  const [activePreset, setActivePreset] = useState<string | null>(DEFAULT_PRESET.id)
  const [hint, setHint] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<Drag['kind'] | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  /** Once the user pans or zooms, the viewport is theirs and we stop auto-fitting. */
  const viewOwnedRef = useRef(false)
  const hintTimer = useRef<number | null>(null)
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const shape = useMemo(() => shapeById(shapeId), [shapeId])
  const anchor = useMemo(() => add2(camera.p, anchorOffset), [camera.p, anchorOffset])
  const placement = useMemo(() => ({ scale, depth, anchor }), [scale, depth, anchor])
  const scene = useMemo(() => buildScene(camera, shape, placement), [camera, shape, placement])
  const ground = useMemo(
    () => (toggles.groundGrid ? groundGridSegments(camera, placement) : []),
    [toggles.groundGrid, camera, placement],
  )
  const vps = useMemo(() => vanishingPoints(camera), [camera])
  const euler = useMemo(() => matToEuler(camera.R), [camera.R])

  const showHint = useCallback((message: string | null) => {
    setHint(message)
    if (hintTimer.current) window.clearTimeout(hintTimer.current)
    if (message) {
      hintTimer.current = window.setTimeout(() => setHint(null), 4200)
    }
  }, [])

  /** Any camera change that isn't a preset click invalidates the preset highlight. */
  const applyCamera = useCallback((next: Camera) => {
    setCamera(next)
    setActivePreset(null)
  }, [])

  // -- sizing --------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fitAll = useCallback(
    (cam: Camera = camera, w = size.w, h = size.h) => {
      if (w < 10 || h < 10) return
      setView(fitViewport(contentBounds(cam, FRAME), w, h))
    },
    [camera, size.w, size.h],
  )

  // Keep everything framed while the user has not taken the viewport over, so a
  // window resize before the first interaction does not leave the view stranded.
  useEffect(() => {
    if (viewOwnedRef.current || size.w < 10) return
    fitAll(camera, size.w, size.h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h])

  // -- render loop ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w < 1 || size.h < 1) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr)
      canvas.height = Math.round(size.h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const frameId = requestAnimationFrame(() => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw({
        ctx,
        width: size.w,
        height: size.h,
        view,
        camera,
        scene,
        frame: FRAME,
        ground,
        toggles,
        hoverHandle: hover,
        activeHandle,
      })
    })
    return () => cancelAnimationFrame(frameId)
  }, [size, view, camera, scene, ground, toggles, hover, activeHandle])

  // -- hit testing ---------------------------------------------------------
  const localPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const handleAt = useCallback(
    (pt: Vec2): number | null => {
      for (let axis = 0; axis < 3; axis++) {
        const pos = handleScreenPosition(vps[axis], camera, view, size.w, size.h)
        if (Math.hypot(pos.x - pt.x, pos.y - pt.y) <= HANDLE_HIT_RADIUS) return axis
      }
      return null
    },
    [vps, camera, view, size.w, size.h],
  )

  const onFrameBorder = useCallback(
    (pt: Vec2): boolean => {
      const tl = toScreen(view, { x: camera.p.x - FRAME.w / 2, y: camera.p.y - FRAME.h / 2 })
      const w = FRAME.w * view.zoom
      const h = FRAME.h * view.zoom
      const t = FRAME_BORDER_TOL
      const inOuter =
        pt.x >= tl.x - t && pt.x <= tl.x + w + t && pt.y >= tl.y - t && pt.y <= tl.y + h + t
      const inInner =
        pt.x > tl.x + t && pt.x < tl.x + w - t && pt.y > tl.y + t && pt.y < tl.y + h - t
      return inOuter && !inInner
    },
    [view, camera.p],
  )

  const onObject = useCallback(
    (pt: Vec2): boolean => {
      const hull = scene.hull.map((p) => toScreen(view, p))
      return hull.length >= 3 && pointInConvexPolygon(hull, pt)
    },
    [scene.hull, view],
  )

  // -- pointer -------------------------------------------------------------
  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
        canvasRef.current.releasePointerCapture(e.pointerId)
      }
    } catch {
      /* already released */
    }
    dragRef.current = null
    setDragKind(null)
    setActiveHandle(null)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = localPoint(e)
    // Capture keeps the drag alive when the pointer leaves the canvas. It can
    // refuse (no active pointer); that must not stop the drag from starting.
    try {
      canvasRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* not capturable — the drag still works while the pointer stays over us */
    }

    const begin = (drag: Drag) => {
      dragRef.current = drag
      setDragKind(drag.kind)
    }

    if (e.button === 1 || e.altKey) {
      begin({ kind: 'pan', last: pt })
      return
    }

    const axis = handleAt(pt)
    if (axis !== null) {
      const vp = vps[axis]
      const grab =
        vp.kind === 'finite' ? sub2(vp.at, toFrame(view, pt)) : { x: 0, y: 0 }
      begin({ kind: 'vp', axis, grab })
      setActiveHandle(axis)
      return
    }

    if (onFrameBorder(pt)) {
      begin({ kind: 'frame', grab: sub2(camera.p, toFrame(view, pt)) })
      return
    }

    if (onObject(pt)) {
      begin(
        e.shiftKey
          ? { kind: 'anchor', grab: sub2(anchor, toFrame(view, pt)) }
          : { kind: 'rotate', last: pt },
      )
      return
    }

    begin({ kind: 'pan', last: pt })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = localPoint(e)
    const drag = dragRef.current

    if (!drag) {
      setHover(handleAt(pt))
      return
    }
    // If the button came up somewhere we never heard about (pointer left the
    // window, the browser swallowed the event), don't stay stuck mid-drag.
    if (e.buttons === 0) {
      endDrag(e)
      return
    }

    switch (drag.kind) {
      case 'vp': {
        const target = add2(toFrame(view, pt), drag.grab)
        const out = dragVanishingPoint(camera, drag.axis, target)
        applyCamera(out.camera)
        if (out.clamped) {
          showHint(out.reason === 'degenerate' ? DEGENERATE_HINT : NONACUTE_HINT)
        }
        break
      }
      case 'rotate': {
        const dx = pt.x - drag.last.x
        const dy = pt.y - drag.last.y
        drag.last = pt
        setCamera((c) => ({ ...c, R: trackballRotate(c.R, dx, dy) }))
        setActivePreset(null)
        break
      }
      case 'anchor':
        setAnchorOffset(sub2(add2(toFrame(view, pt), drag.grab), camera.p))
        break
      case 'frame':
        applyCamera({ ...camera, p: add2(toFrame(view, pt), drag.grab) })
        break
      case 'pan': {
        const dx = pt.x - drag.last.x
        const dy = pt.y - drag.last.y
        drag.last = pt
        viewOwnedRef.current = true
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }))
        break
      }
    }
  }

  // Wheel needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      viewOwnedRef.current = true
      const r = canvas.getBoundingClientRect()
      const pt = { x: e.clientX - r.left, y: e.clientY - r.top }
      const v = viewRef.current
      const zoom = Math.min(8, Math.max(0.002, v.zoom * Math.exp(-e.deltaY * 0.0016)))
      const anchorFrame = toFrame(v, pt)
      setView({
        zoom,
        tx: pt.x - anchorFrame.x * zoom,
        ty: pt.y - anchorFrame.y * zoom,
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // -- control callbacks ---------------------------------------------------
  const onPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    setCamera(preset.camera)
    setAnchorOffset(preset.anchorOffset)
    setDepth(preset.depth ?? DEFAULTS.depth)
    setActivePreset(preset.id)
    showHint(preset.hint)
    fitAll(preset.camera)
  }

  const onReset = () => {
    setCamera(DEFAULT_PRESET.camera)
    setAnchorOffset(DEFAULT_PRESET.anchorOffset)
    setScale(DEFAULTS.scale)
    setDepth(DEFAULTS.depth)
    setToggles(DEFAULT_TOGGLES)
    setActivePreset(DEFAULT_PRESET.id)
    showHint(null)
    fitAll(DEFAULT_PRESET.camera)
  }

  const onToggleInfinity = (axis: number) => {
    if (infiniteAxes(camera).includes(axis)) {
      applyCamera({ ...camera, R: bringAxisBackFromInfinity(camera.R, axis) })
      return
    }
    const R = sendAxisToInfinity(camera.R, axis)
    if (!R) {
      showHint('Two axes are already at infinity — three orthogonal directions cannot all be parallel to the picture plane.')
      return
    }
    applyCamera({ ...camera, R })
    showHint(
      'That axis now runs parallel to the picture plane: its edges are parallel on screen and its vanishing point is at infinity.',
    )
  }

  const cursor = dragKind
    ? dragKind === 'rotate'
      ? 'grabbing'
      : 'grabbing'
    : hover !== null
      ? 'grab'
      : 'default'

  return (
    <div className="app">
      <Controls
        camera={camera}
        vps={vps}
        euler={euler}
        shapeId={shapeId}
        scale={scale}
        depth={depth}
        toggles={toggles}
        activePreset={activePreset}
        onFocal={(f) => applyCamera({ ...camera, f })}
        onEuler={(e) => applyCamera({ ...camera, R: matFromEuler(e.yaw, e.pitch, e.roll) })}
        onShape={setShapeId}
        onScale={setScale}
        onDepth={setDepth}
        onToggle={(key) => setToggles((t) => ({ ...t, [key]: !t[key] }))}
        onPreset={onPreset}
        onReset={onReset}
        onFitAll={() => fitAll()}
        onToggleInfinity={onToggleInfinity}
      />

      <div className="stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        />
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  )
}
