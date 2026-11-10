# Skill: PlayCanvas in Kodyurd

Applies to `packages/ui/src/viewer/**`. These rules cover the engine lifecycle,
rendering and navigation. Breaking them can cause double update loops after
remount, leaked listeners, invisible GLBs, z-fighting facades.

## Version

- `playcanvas` is pinned **exactly `2.22.6`** in `packages/ui/package.json`.
  2.x minor releases have shifted small APIs (fog, among others). If you must bump:
  bump deliberately, re-test viewer + export viewer, and keep the fog guard.
- Fog: accessed defensively (`app.scene.fog` as an object with `type/start/end/color`)
  inside try/catch, because its shape drifted across 2.x. Never assume it.

## One owner (lifecycle law)

`createViewer()` is the single owner of:

- the `pc.Application` (created once per canvas mount),
- the **one** `app.on("update", ...)` handler,
- the **one** `ResizeObserver`,
- pointer-lock + keyboard listeners,
- `dispose()`, which must remove every listener it added, disconnect the observer,
  `app.off("update")`, exit pointer lock if held, and `app.destroy()`.

React components call `createViewer` in an effect and `dispose()` in its cleanup.
Never add a second update loop (no `requestAnimationFrame` on the side, no extra
`app.on("update")` elsewhere). Animations (gem spin/float) run inside the one loop.

## Semantic root vs visual children

Every scene item gets a root entity at `(worldX, 0, worldZ)`. All visual parts are
*children* in local space via the `part()` helper. Focus, labels, bird mode and
teleport read semantic records (`interactables`, `labelPoints`, layout
positions) — never visual transforms. So you
can restyle visuals freely without touching interaction code, and vice versa.

## Conventions

- Units: metres. Axes: +Y up, −Z forward. Angle setters take **degrees**.
- A `render: box` component is a unit cube; `setLocalScale` *is* its size.
- Materials: always through the cached `materialFor(hex, emissive?, intensity?)` —
  scenes have hundreds of boxes; per-box `new StandardMaterial()` wrecks perf.
  After mutating a material, `update()` (the helper does it).
- Facade glow strips are scaled ~1.016× the body so they sit proud of the surface —
  that is the z-fighting fix; keep the oversize if you restyle.
- No `castShadows`: a directional shadow map stretched over the ~900 m ground is
  both ugly and slow. Depth comes from the two directional lights + emissives.
- HUD work (labels via `cam.worldToScreen`, player position) is throttled to ~8 Hz;
  keep heavy per-frame work out of the label pass.

## GLB mounting (sculpted style)

- Fetch each queued GLB once, then pass its bytes and original URL to the
  PlayCanvas container loader. Instantiate the loaded resource under the item root.
- **AABBs are only valid after the renderer has seen the model.** Wait
  `app.once("update", ...)`, union all `meshInstance.aabb`s, then scale
  `target / maxDim`; wait one more frame, re-measure, and shift local Y so the
  model's bottom sits on the mount point.
- Hide the builder's replacement parts while a listed asset is pending. Reveal
  the GLB after fitting and seating. Restore the procedural visuals only when
  the file is missing or invalid. A temporary opening failure offers a retry.
- The opening cover waits for the avatar and visible entrance models through
  their first fitted render. Queue visible and nearby assets as the view moves.

## Export viewer

The static export reuses `SpaceViewer` in offline mode: `export-main.tsx` fetches
`./space.json` and pack models resolve to relative `models/<role>.glb` (guide and
source reading are disabled honestly). Anything you add to the engine must work
from a static folder — no server assumptions inside the engine.
