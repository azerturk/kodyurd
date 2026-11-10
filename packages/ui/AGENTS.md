# AGENTS.md — packages/ui

React 18 + Tailwind v4 + Vite. Bundled imports — **no `.js` suffixes here** (unlike the
Node packages). `npm run build` at the repo root builds this via Vite.

ONE viewer (the legacy v0.1 `engine.ts`/`SceneViewer.tsx` were removed in the
final-system sprint — do not resurrect them):

- `viewer/space-engine.ts` + `SpaceViewer.tsx` — the Knowledge City. All 3D work happens
  here. `SpaceViewer` also powers the static export: pass
  `offline={{ payload, packRoles, assetBase }}` and it runs with zero API calls (guide tab
  hidden, source reading shows an honest note). `export-main.tsx` is that entry — it
  fetches `./space.json` from the bundle.
- Tour autopilot lives in the engine (`walkTo` straight-line walk with manual
  override, `setTrail` ground dots, `onAutoArrive`); the viewer adds the auto
  toggle, narration-timed advance and the trophy modal. Personal overlays mount
  via `mountUrl` (landmark statue by the door, emblem above it, centerpiece on
  the lobby pedestal, icon floating in the lobby) — procedural-fallback rules
  unchanged.

Engine rules (full version: `docs/skills/playcanvas.md`):

- **playcanvas pinned exactly `2.22.6`** — do not bump, do not use APIs outside it.
- **One owner**: a single `pc.Application`, one update loop, one resize observer, and a
  `dispose()` that removes every listener and destroys the app. Never add a second loop.
- Semantic entity per thing; visuals are children, so focus/teleport/labels never depend
  on meshes. Positions in metres, +Y up.
- Canvas-texture screens: redraw at most ~10 Hz, re-upload via `texture.setSource`;
  budget-conscious (text panels are the main VRAM cost).
- **Bundled pack models**: resolve role → `/api/assets/pack/<role>.glb` through the
  `PackAssets` registry. Hide the replacement geometry while a listed asset is
  pending and reveal the GLB only after fitting. Missing or invalid files use
  procedural geometry. The opening cover waits for the first view's fitted models.
- **Character animations**: the pack character mounts from
  `character-default.anim.idle` and registers idle/walk/run/jump as states on the anim
  component's implicit layer; movement state drives `baseLayer.transition(name, ~0.16)`.
  A hip/root bone matched by name is re-anchored each frame (root-motion guard) so walk
  cycles never slide the mesh off the controller. An unavailable idle rig tries the
  installed rigged and static character files before the procedural figure.
- Agent-directed presentation arrives ONLY as bounded tokens (accents, panel variants,
  camera shots) already validated by the schema — never execute strings from scene data.
- DOM overlays (labels, drawer, modals) live in React, not in the engine; the engine
  reports via callbacks (`onFocus`, `onLabels`, `onInspect`, ...).

UI copy is English; scene content language comes from the document. No tier words, no
"coming soon".
