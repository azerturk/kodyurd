# AGENTS.md — Kodyurd agent guide

You are working on **Kodyurd**: `npm ci` → `npm run build` → `npm start` → a local app on
`127.0.0.1:4717`. The user points it at a folder; their own AI agent reads it read-only and
emits **Scene JSON**, which a deterministic PlayCanvas engine renders as ONE game-like,
walkable **knowledge city** — buildings are the real modules, animated engineering diagrams
and flows explain how the system works, interiors carry the docs' full depth, and the
learning loop (tour, checkpoints/exam, guide Q&A, drawer menu with open-in-editor) lives
inside the scene. Exportable as a static bundle. No cloud, no telemetry, no tiers.

Read the nearest `AGENTS.md` before editing `packages/scene-schema`, `packages/server`
or `packages/ui`. Follow the matching area guide.
Chat instructions from the user override this guide.

## Source of truth (read before coding)

| Question | Read |
|---|---|
| What are we building? | `docs/ARCHITECTURE.md` |
| How does Claude Code load the shared rules? | `CLAUDE.md` imports this guide |
| Where do 3D models come from? | `docs/ASSETS.md` (bundled pack story) |
| Area playbooks | `docs/skills/playcanvas.md`, `scene-schema.md`, `tripo.md`, `agents-runtime.md` |
| Review real screens, walking, models and export | `docs/skills/visual-qa.md` |

## Scene contracts

- Scene JSON v0.2 describes the Knowledge City. Preserve compatibility with legacy
  v0.1 zones and items through the upgrade path in `parseSpace`.
- `packages/server/prompts/` contains the runtime playbook. The server validates
  the plan and evidence, then lays out the city for the shared live and export viewer.
- **The standard release includes the model pack.** The PackAssets registry resolves
  installed roles. The renderer uses built-in geometry when a model is missing or invalid.
- Agent answers go through a deterministic pre-validation layer
  (`normalizeCityPlan` / `normalizeBuildingPass` in `space-pipeline.ts`) BEFORE zod:
  over-long strings are clamped, out-of-enum values dropped, unfixable items removed —
  the single repair pass is reserved for real structural problems. When you extend the
  schema, extend the matching normalizer in the same change.
## Commands

- Use **Node >= 22.13** (`node -v`) for the standard commands. Node 22.5–22.12 requires
  `--experimental-sqlite` to load `node:sqlite`.
- `npm ci` — install from the lockfile.
- `npm run build` — builds in dependency order: scene-schema → server → ui → cli.
  **Run this to verify any change; it must exit clean.**
- `npm start` — run the built CLI (`kodyurd run`).
- `npm run doctor` — environment checks.
- Per-workspace build: `npm run build -w @kodyurd/server` (same for the other packages).
- Faster loop for server/schema work:
  `npx tsc -p packages/scene-schema/tsconfig.json && npx tsc -p packages/server/tsconfig.json --noEmit`
  (schema must be BUILT first — server resolves its `dist`).
  ⚠ `--noEmit` hides declaration-emit errors (e.g. TS4023 "cannot be named"), so ALWAYS
  finish with the real `npm run build` before calling a change done.
- `npm test` — deterministic tests after a build. Smoke-test generation, walking and
  export with `examples/harbor-desk` when a change affects those paths. For schema
  changes, keep old exported scenes valid.

## Hard rules (non-negotiable)

1. **Runtime agents never write engine code.** They output Scene JSON only; `parseScene` /
   `parseSpace` (zod) is the gate. Never eval, never render agent HTML/JS. Presentation is
   agent-directed ONLY through bounded enum tokens (accents, panel variants, camera shots)
   — never free-form CSS/JS strings.
2. **playcanvas is pinned exactly `2.22.6`.** Do not bump.
3. **Privacy is the product.** Zero telemetry; keys only in `~/.kodyurd/config.json` (env
   wins) and sent only to their own provider. Env/config features show **names only,
   never values**. Keep the network-transparency table in `docs/PRIVACY.md` accurate.
4. **No tier language, no "coming soon".** Three model layers (bundled pack → optional
   personal Tripo overlay, five offer classes only → procedural fallback) are all
   first-class; the keyless install must look excellent.
5. **One space, no scene types.** Never add pre-generation modes; capabilities go
   INSIDE the scene. `scene_type` in the DB is a legacy column.
6. **Coherence law.** Every placed element answers a walker's question (what is this /
   how does it work / what's the flow / what matters in this doc / did I understand).
   Nothing decorative, nothing disconnected.
7. **TypeScript strict everywhere.** `scene-schema`/`server`/`cli` are NodeNext ESM —
   relative imports need `.js` suffixes. `packages/ui` is bundled by Vite — no suffixes.
8. **Dependencies are a liability.** Full runtime list today: fastify, @fastify/static,
   zod, archiver, playcanvas, react, react-dom (+ vite/tailwind as dev). Adding anything
   needs a strong reason — people audit this CLI.
9. **Bounded loops.** One zod-repair pass per agent call, per-stage timeouts, never
   unbounded retries, and the paid-API receipt law for every Tripo call (receipt persisted
   BEFORE submit; an unknown outcome permanently blocks resubmission).
10. **English UI and docs; scene CONTENT follows the project's language.** Grounding law:
    every readable text carries a `source` to a real file or is counted pending — nothing
    is invented.

## Repo map

- `packages/scene-schema` — the contract (v0.1 `index.ts`, v0.2 `space.ts`,
  `layout-types.ts`). **Security boundary.**
- `packages/server` — Fastify on 127.0.0.1:4717: `analyzer.ts` (v2), `space-pipeline.ts`
  (P1/P2 + sanitize), `space-layout/` (deterministic geometry), `prompts/` (the generation
  playbook), `jobs.ts` (the space job: focus and brief-driven lessons + content-hash cache ⇒
  incremental re-builds), `saved-cities.ts` (one city kept per brief), `diagram-edits.ts` (diagrams
  the user corrected, imported or drew), `tripo.ts` (personal overlay, receipt law), `routes.ts`,
  `export.ts` (static city bundle). SQLite via `node:sqlite`.
- `packages/ui` — React + Tailwind + Vite: `viewer/space-engine.ts` + `SpaceViewer.tsx`
  (the shared viewer), `screens/*`, `export-main.tsx` (offline city-bundle entry).
- `packages/cli` — the `kodyurd` bin.
- `packages/assets` — the bundled model pack (GENERATED — see Danger zones).
- `examples/harbor-desk` — the example workspace and standalone reservation service.

## Working style

- Small files, pure helpers, early returns; errors as typed codes
  (`AgentError(code, message)`) surfaced into the job log.
- Job stage lines are the user's UX during generation: short, present tense, honest,
  never leaking prompts or keys.
- Before touching an area, read its nested `AGENTS.md` and the matching skill doc.
- Commit style: small focused commits, English, imperative ("add corridor forks to
  interior layouter").

## Danger zones

- **`packages/assets/models/` and `packages/assets/manifest.json`** — generated artifacts.
  Never hand-edit; they are produced only by the pack scripts.
- **`packages/scene-schema`** — changes affect prompts, pipeline validation,
  layout and the live and export viewers. Follow the change checklist in
  `docs/skills/scene-schema.md`.
