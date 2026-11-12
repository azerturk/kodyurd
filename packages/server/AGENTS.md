# AGENTS.md — packages/server

Fastify server bound to 127.0.0.1 only. NodeNext ESM — relative imports need `.js`
suffixes. SQLite via `node:sqlite` (Node >= 22.5), no ORM.

Map:

- `analyzer.ts` — deterministic, read-only scan: adaptive module discovery (recursive
  split), doc→module fuzzy mapping, cross-cutting detection, mermaid/table/decision
  block inventory. Framework-agnostic by rule — never special-case Laravel/React/etc.
- `source-paths.ts`, `documents.ts`, `source-declarations.ts` — shared path rules (document
  formats, test files), the line-for-line Markdown view of reStructuredText and AsciiDoc used by
  the index, the Mermaid importer and the reader, and where a code excerpt opens per language.
- `prompts/` — the **Agent Generation Playbook**: playbook.md and city-plan.md for the city
  plan, focus-deliverable.md for each lesson part. They ARE product behavior.
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
- `jobs.ts` — job rows + `startSpaceJob`, the ONLY generation job: city plan (one repair at
  most) → lessons, each built from independent deliverables (`focus-generation.ts`) with a
  content-hash cache per deliverable under `projects/<id>/cache/` (`fresh: true` bypasses it).
  The focus and pinned lessons publish the city; lessons the brief adds follow two at a time,
  and a failed one stays pending and is reported → sanitize/validate → layout → `space.json` +
  `offers.json`. The per-job model override threads through `AgentRunOptions.model`
  (claude `--model` / codex `-m` / API body model).
- `diagram-edits.ts`, `drawio.ts` — the user's own diagrams (corrections, imports, drawings):
  validated by the scene schema, stored beside the city and laid over it on read. `drawio.ts`
  reads the first page of a diagrams.net file; pasted Mermaid goes through `authored-diagrams.ts`.
  The editor can never add a citation or a claim — only the saved diagram supplies them.
- `lesson-plan.ts` — which buildings one job teaches: the focus, pinned modules and the buildings
  the plan read out of the brief, with the bounds that keep a job finite.
- `guide.ts` — the in-scene guide: one awaited agent answer, cited from the open city's evidence.
- `project-files.ts`, `saved-cities.ts` — where a workspace keeps its generated files, and the
  bounded list of cities it has generated: one per brief, the newest generation replacing the
  earlier one. Opening an entry copies its draft back to `space.json`; generations that are
  neither listed nor recent are removed.
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
`KODYURD_AGENT_TIMEOUT_MS` and `KODYURD_ASK_TIMEOUT_MS`. The brief decides how many
buildings get a lesson; the bounds (`LESSON_FLOOR`, `LESSON_CEILING`, `LESSON_POOL`)
live in `jobs.ts`. Keep stage lines short, honest and in the present tense. Keep prompts and keys out of logs.

Typecheck: `npx tsc -p packages/scene-schema/tsconfig.json && npx tsc -p
packages/server/tsconfig.json --noEmit`.
