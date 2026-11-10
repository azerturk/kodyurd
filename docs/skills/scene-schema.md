# Skill: Scene JSON contract

Applies to `packages/scene-schema/**` and anything that produces or consumes scenes.
The schema is the **security boundary**: runtime agents output only this JSON, and
`parseScene` (zod) is the gate. Nothing an agent writes may ever become code.

> **Current shape: v0.2 "Space"** (`src/space.ts`) — ONE knowledge city
> (no `sceneType`), plus `interiors`, richer `diagrams` (graph/sequence/state/matrix/ERD,
> icon roles from the asset registry) and bounded `presentation` tokens (accents,
> panel variants, camera shots). See the [architecture overview](../ARCHITECTURE.md).
> Generation writes v0.2. `parseSpace` accepts v0.1 documents through
> `upgradeSceneToSpace`.

## Scenario replay and source ranges

- A flow may name its steps with flow-local `id` values and describe them with
  `actor`, `detail`, `state` and `source`. Example state is display data.
- Branches may identify a main-path fork with `from` and rejoin the main path
  with `join`. `at` still supports older documents.
- `scenarios` reference the same steps in execution order. Each trace starts at
  the entry step, and every transition follows a declared edge. Repeating a
  step is valid when the graph permits a retry. Playback is finite.
- Optional `scenario.events` attach exact-source detail and display state to a
  zero-based `stepIndex` in that scenario. Events share the base graph node and
  its geometry. Event state replaces the base step's display state at that one
  position.
- Diagram nodes and edges can carry individual source ranges. `presentation.start`
  identifies the entrance building and its initial diagram and flow by ID.
- Diagrams may include up to 24 Explain claims. A claim has an ID, an existing
  node or identified edge target, a bounded kind, plain text, and up to three
  exact code, documentation, or test ranges. A documented decision quotes
  the authored rationale from its cited range. A disagreement cites both the
  document and the implementation or test.
- The server verifies claim ranges against the supplied packet and fingerprints
  each accepted span. A trusted live read marks changed spans stale. An optional
  claim replay link resolves an exact flow, scenario, step ID and occurrence.
  The renderer needs no separate geometry for Explain.
- Generated diagram node labels are bounded at 60 characters for spatial cards
  and 140 for decision tables, which show full conditions and results in the inspector.
- Sequence edges use `return` for replies. State diagrams use `initial`, `state`,
  and `terminal` node hints with optional transition `guard` labels. Rendering
  reads bounded semantic hints and keeps source and interaction anchors stable.
- An ERD uses `kind: "erd"`. Entity nodes may list typed fields with `PK`, `FK`,
  or `UK` keys and exact sources. Each relationship has `cardinality: { from, to }`
  with `1`, `0..1`, `1..*`, or `0..*` at each end. The authored Mermaid importer
  keeps only fully supported blocks and preserves their line references.
- `assessment.questions` is optional. `choice` and `target` each reference one
  option ID. An `order` answer is a permutation of all option IDs. Every question
  has a source line or range. Optional `building` and `replay` refs resolve in
  the assembled city. Use `scenario`, `step` and zero-based `stepIndex` together
  to point to an exact occurrence. Legacy links open only if their step resolves
  to a single occurrence. The UI offers scenario start when a link is ambiguous.

## Shape (v0.1 — upgrade input only, no longer generated)

- `version: "0.1"`, `meta { name, sceneType: codewalk|showroom|exhibition|training,
  sourceDir, language (default "en"), createdAt }`.
- `zones[]`: `kind: hall|district|bridge|library|gallery|custom`, `position {x,z}`,
  `size {w,d}`, `items[]`. Item positions are **zone-relative**.
- `items[]`: `kind: building|panel|plaque|pedestal|door|sign|flowchart|stack|timeline`;
  `title`, `summary?`, `source? {path}`, `pending?`, `height?` clamped 2..30,
  `target?` (door → zone id), `metrics?`.
  - `steps? [{label ≤60, detail? ≤200}]` — **required** for flowchart/timeline (2..8, in order).
  - `layers? [{label, detail?}]` — **required** for stack (2..7, bottom-up).
  - `model? { prompt: 8..400 chars }` — agent-written sculpt brief (physical object
    description only).
  - `modelUrl?` — **server-written only** (Tripo pipeline). Agents must never set it;
    the prompt contract doesn't mention it.
- `flows[]` (≤40): `{ from, to, label? ≤48, kind: calls|data|next|depends }` —
  directed relations between **existing item ids** (superRefine checks both ends and
  from≠to). The engine renders them as glowing arcs with moving pulses; the tour
  highlights the flows touching the current stop. This is the main "explain" device.
- `tour[]`: `{ zoneId, itemId?, narration, checkpoint? }`.
- `checkpoint`: `question`, 2–4 `options`, **exactly one** `correct: true`
  (zod `.refine` enforces it), `explanation?`.

## Change checklist

1. `packages/scene-schema/src/space.ts` — the v0.2 Zod schema and `SPACE_CONTRACT_NOTE`.
2. `packages/server/prompts/*.md` + `packages/server/src/space-pipeline.ts` — the
   contract text the agents read, the prompt
   builders and the `normalizeCityPlan`/`normalizeBuildingPass` pre-validation.
   The contract must describe reality, not aspiration.
3. `packages/ui/src/space-types.ts` — the mirrored TS types.
4. `packages/ui/src/viewer/space-engine.ts` — the interpreter (and `space-layout/`
   if spatial).
5. `packages/server/src/export.ts` — if the field references assets/paths.
6. `docs/skills/scene-schema.md` — this file.

Rules:

- **Additive optional fields only** within a version. Anything breaking bumps
  `version` and must keep parsing old scenes (or migrate them explicitly).
- Validation failure path is: one repair pass (`buildSpaceRepairPrompt` with the zod
  issues) → parse again → fail the job with the issues in the log. Never loosen the
  schema to make a bad generation pass; fix the prompt instead.
- Defaults live in the schema (`language: "en"`, `tour: []`) so consumers never
  null-check what the schema guarantees.
