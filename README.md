# Perspective

An interactive three-point perspective explorer. A 3D object is drawn in true
linear perspective; drag the three vanishing points around the plane and the
object reorients, because dragging a vanishing point solves for a new **camera**
rather than distorting the drawing.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # vitest, on the pure math module
npm run build
```

## The idea

The three vanishing points are not independent. For a pinhole camera with square
pixels, the vanishing point of a direction `d` in camera coordinates is

```
V = ( px + f·d.x/d.z ,  py − f·d.y/d.z )
```

Inverting that, a vanishing point `V` corresponds to

```
d ∝ ( (Vx − px)/f ,  −(Vy − py)/f ,  1 )      // canvas y is down, world y is up
```

and requiring three axes to be mutually orthogonal, `di · dj = 0`, expands to

```
(Vi − p)·(Vj − p) + f² = 0        for all three pairs
```

Two things fall out, and the whole app rests on them:

1. **`p` is the orthocenter of triangle `V1 V2 V3`.** Subtracting any two of the
   equations gives `(p − Vi)·(Vj − Vk) = 0` — `p` lies on every altitude. Two
   altitudes make a 2×2 linear system.
2. **`f² = −(V1 − p)·(V2 − p)`**, which is positive only when the triangle is
   **acute**. An obtuse or degenerate triangle describes no real camera at all.

So the recovery pipeline is

```
V1,V2,V3  →  p = orthocenter  →  f  →  d1,d2,d3  →  R = [s1·d1 | s2·d2 | s3·d3]
```

Each `si ∈ {−1,+1}` is free. We pick the combination with `det(R) = +1` that is
closest to the previous frame — maximising `Σ si (di · prev_col_i)` minimises
`‖R − R_prev‖_F`, and the determinant fixes the parity, so a wrong-parity greedy
choice is repaired by flipping the least-committed axis. Without that, the object
flips and pops while you drag.

## Two views of one state

State is the camera, `{ R, f, p }` — 3 + 1 + 2 = 6 degrees of freedom. The three
vanishing-point positions are also 6 numbers, and are a bijective alternate view
of the same state. Every control writes into `{R, f, p}`:

| gesture | effect |
| --- | --- |
| drag a vanishing point | solve for a new `{R, f, p}` from the three positions |
| drag the object | changes `R`; the vanishing points move |
| focal length slider | changes `f`; the vanishing points scale radially about `p` |
| drag the frame edge | changes `p`; the vanishing-point triangle translates rigidly |

Both directions are live at all times; `src/lib/interact.test.ts` asserts each
row of that table.

## The acute constraint

While dragging, a requested position that makes the triangle non-acute is
refused. We bisect along the segment from the last valid position to the request
and settle on the last point that still resolves to a real camera, with a minimum
focal length supplying the margin. The altitudes and the orthocenter are drawn
faintly so the rule is visible rather than merely enforced.

## Limiting cases

With a vanishing point at infinity the orthocenter construction collapses, and
each case is handled on its own terms:

- **One at infinity** (two-point). Its direction `u` must be perpendicular to the
  line joining the other two, and `p` lies *on* that line, with
  `f² = |V1 − p|·|V2 − p|`. The remaining freedom is where `p` sits along the
  segment; we hold that fraction while dragging.
- **Two at infinity** (one-point). The single finite vanishing point *is* the
  principal point, and `f` is unconstrained.
- Three at infinity is impossible — three orthogonal directions cannot all be
  parallel to the picture plane — and the `∞` button says so.

## Layout

```
src/lib/perspective.ts   pure math: camera, recovery, clipping, hulls, tangents
src/lib/shapes.ts        ShapeDef data — cube, box, L-block, cylinder, cone
src/lib/scene.ts         camera + shape + placement → projected, culled scene
src/lib/interact.ts      each gesture, as a camera-to-camera function
src/lib/presets.ts       defaults and the four presets
src/render/draw.ts       canvas renderer, layered back to front
src/render/theme.ts      palette and line weights, shared with the CSS
src/ui/Controls.tsx      the control column
src/App.tsx              state, hit testing, pointer handling
```

`perspective.ts` imports nothing. `shapes.ts`, `scene.ts` and `interact.ts`
import only from it. Nothing below `src/render` knows about React or the DOM.

## Controls

Drag the three labelled handles. Drag the object to turn it, shift-drag to
reposition it, drag the frame edge to pan the picture plane, scroll to zoom, and
drag empty space to pan the viewport. At realistic focal lengths the vanishing
points sit far outside the frame, so **Fit all vanishing points** is the button
you will use most.

Adding a shape is a data change: fill in a `ShapeDef` in `src/lib/shapes.ts` and
add it to `SHAPES`. Faces wind counter-clockwise seen from outside; edges that
run along an object axis are tagged automatically and inherit that axis's
vanishing point and colour.

## Tests

54 tests over the pure modules, including the ones that matter most:

- **Round trip** — random `{R, f, p}` → three vanishing points → recovery
  reproduces `p`, `f` and `R` to 1e-9.
- **Orthocenter** — the recovered `p` satisfies all three altitude equations.
- **Orthogonality** — recovered axes are mutually orthogonal with `det(R) = +1`.
- **Rejection** — obtuse and collinear configurations report `f² ≤ 0` and an
  explicit reason instead of leaking NaN.
- **Continuity** — walking a vanishing point 720 steps around a closed loop never
  flips a sign of `R`, and returns to the starting orientation.
