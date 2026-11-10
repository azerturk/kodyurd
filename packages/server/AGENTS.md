# AGENTS.md — packages/server

Fastify server bound to 127.0.0.1 only. NodeNext ESM — relative imports need `.js`
suffixes. SQLite via `node:sqlite` (Node >= 22.5), no ORM.

Map:

- `analyzer.ts` — deterministic, read-only scan: adaptive module discovery (recursive
  split), doc→module fuzzy mapping, cross-cutting detection, mermaid/table/decision
  block inventory. Framework-agnostic by rule — never special-case Laravel/React/etc.
- `prompts/` — the **Agent Generation Playbook** (playbook.md + city-plan.md +
  building-pass.md). These are injected into every P1/P2 run; they ARE product behavior.
  Edit with the same care as code; placeholders are `{{UPPER_SNAKE}}`.
- `space-pipeline.ts` — P1/P2 prompt builders, `CityPlan`/`BuildingPass` zod gates,
  `assembleSpace`, `sanitizeSpace` (unresolved flow refs become `step:<slug>`, unknown
  owners fall back to "city", dangling entries are dropped), `finalizeSpace` — and the
  deterministic PRE-validation layer `normalizeCityPlan` / `normalizeBuildingPass`:
  clamp over-long strings, drop out-of-enum values and unfixable items BEFORE zod, so
  the single repair pass is spent on structure, not trivia. Schema change ⇒ extend the
  normalizer in the same change. Validation failures must log their issues into the
  job stages (`issuesOf`), never a bare "failed".
- `space-layout/` — deterministic geometry (city, interior, diagram). Pure functions,
  no deps, no randomness: same document in → same layout out. The diagram layouter is
  written in-repo on purpose; do not import a graph library.
- `jobs.ts` — job rows + `startSpaceJob` (the ONLY generation job: P1 → one repair max →
  P2 passes in a concurrency pool with a per-building content-hash cache under
  `projects/<id>/cache/` — an unchanged building loads from cache, so re-builds are
  incremental; `fresh: true` bypasses it — plus one bounded empty-pass retry; an invalid
  pass marks its building pending, the city still assembles → sanitize/validate → layout →
  `space.json` + `offers.json`). The per-job model override threads through
  `AgentRunOptions.model` (claude `--model` / codex `-m` / API body model).
- `startOverlayJob` — one offered overlay per click with the USER'S Tripo key
  (receipt law + global prompt-hash cache via `generateOverlayModel`); classes
  landmark/centerpiece/emblem/icon. A character uses a local rigged model pack.
  Result lands in `overlays.json`; `/overlays` serves it, the engine mounts it,
  the export carries it. Shares the one-job-per-project lock with the space job.
- `tripo.ts` — personal overlay, PAID: follows the receipt law in `docs/skills/tripo.md`
  (receipt persisted BEFORE submit; an unknown outcome permanently blocks resubmission,
  a definitive HTTP rejection is retryable; global prompt-hash cache; verified v3 host
  `openapi.tripo3d.ai`). Runtime entry: `generateOverlayModel` — the user's key, one
  model per click.
- `routes.ts` — all endpoints. Path inputs are validated (regex / resolved inside
  sourceDir); keep that discipline for any new route. `/api/assets/*` serves the bundled
  pack read-only; `/api/projects/:id/assets/*` serves overlay GLBs from the Tripo cache;
  `/open` spawns the user's editor on a validated source path (default `code -g`,
  `KODYURD_EDITOR` overrides).

Use bounded loops and one Zod repair per agent call. Configure timeouts with
`KODYURD_AGENT_TIMEOUT_MS` and `KODYURD_ASK_TIMEOUT_MS`. The optional P2 fan-out
uses `KODYURD_P2_LIMIT` (default 3), `KODYURD_P2_CONCURRENCY` (default 2) and
`KODYURD_FULL_INTERIORS` (default 3). Keep stage lines short, honest and in the
present tense. Keep prompts and keys out of logs.

Typecheck: `npx tsc -p packages/scene-schema/tsconfig.json && npx tsc -p
packages/server/tsconfig.json --noEmit`.
