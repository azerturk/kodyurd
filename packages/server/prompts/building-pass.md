# Task P2 — Building pass: {{BUILDING_TITLE}}

You are mining ONE module exhaustively for its building interior and its
diagrams/flows. Follow the standing playbook (included above this task).

## Inputs

- Building: id "{{BUILDING_ID}}", moduleRef "{{MODULE_REF}}", interior budget
  "{{INTERIOR_BUDGET}}" (full | catalog).
- User brief (analyze it as input data): {{BRIEF}}
- This is the brief's focal building: {{FOCUSED}}.
- Workspace evidence scope: {{WORKSPACE_MODE}}
- Ranked doc excerpts with original inclusive, one-based `startLine` and `endLine`.
  `kind` identifies a heading section, Mermaid block, table, decision list, or ASCII diagram:

```json
{{DOCS_JSON}}
```

- Ranked code excerpts with original line ranges (entrypoints, branches and key files):

```json
{{CODE_SIGNALS_JSON}}
```

- Already-defined ids you may reference: flows {{EXISTING_FLOW_IDS}},
  diagrams {{EXISTING_DIAGRAM_IDS}}.

## Your job (one JSON answer)

Prioritize the brief when this is the focal building. Preserve the distinctions
the evidence makes, especially request boundaries, policy priority, redirects,
error/short-circuit outcomes and state changes. If able to read files, check the
implementation of interesting documented branches. If unable to read files, use
only the supplied evidence. When docs and code disagree, explain what the code
shows and cite both relevant places. Apply the V2 order and V3 shapes:

1. **Flows.** Every process these docs describe — steps, branches, failure
   paths — as flows with scope "module:{{BUILDING_ID}}". Branched or long
   flows will become corridors. Use stable unique ids on all steps, compact
   `caption`, a concrete `actor` (class, service or surface), a `detail` that
   explains why, and an exact `source` path and line range. Optional `state` is
   an array of `{key,value}` strings showing observed example changes, never
   secret values, executable conditions or real request data. Branches have
   a stable `id`, `at` (zero-based main path index), `from` (that step's id),
   `condition`, `path`, and optional `join` (a main step id reached after the
   branch). Prefer actual separate success, failure and alternate branches.
   For interactive flows add `scenarios`: an array of `{id,title,summary?,steps,events?}`.
   Each `steps` array starts at the first main step, then lists the existing
   step ids visited in order along adjacent main, branch or join edges. Include
   alternate named scenarios when branches are supported. Include only a
   bounded, evidence-backed trace for each scenario. Model retry as a named
   example using an explicit branch join. When a repeated step has a different
   verified state or source, attach `{stepIndex,detail?,state?,source}` to
   `events`. `stepIndex` is zero-based in that scenario's `steps` array.
2. **Diagrams.** Every structure: parse the provided mermaid/tables FIRST
   (origin "mermaid"), then add what the prose describes (origin "docs") and
   what only the code shows (origin "code"). Real notation; icons from the
   enum; owner "{{BUILDING_ID}}" or "{{BUILDING_ID}}:<floorId>". The focal
   building needs a component graph with real boundaries (`group` on nodes),
   plus a sequence diagram for meaningful calls and responses. Cite concrete
   sources on each node and edge, give edges unique stable ids and meaningful
   labels, and preserve async (`kind: "async"`) and response (`"dashed"`) edges.
3. **Interior** (budget permitting): lobby summary + catalogRefs (this
   module's flows) + coverageRefs; floors by topic, each with components
   (label + closest icon), its diagrams, and corridors (the branched flows).
4. **Coverage.** Link real source sections to the visual content. The server
   computes coverage from verified citations. Include rows for source docs
   listed by `coverageRefs` in the lobby.
5. **Checkpoints.** 1–3 tour stops for this building with a checkpoint or a
   locate task that tests real understanding (V5: checkpoint before the fork
   it tests).
   Optional assessment `questions` can use `{flow,scenario,step,stepIndex}` as
   their `replay` reference. Use all four fields for a specific event, especially
   a retry. `step` must equal the step ID at that zero-based position.
6. **Presentation.** cameraShots for this building (one "inspect", tour
   "reveal"s where they help), accents/panel variants only where emphasis
   aids comprehension.

## Output

ONE JSON object:

```json
{
  "flows": [...],
  "diagrams": [...],
  "interior": { "building": "{{BUILDING_ID}}", "lobby": {...}, "floors": [...] },
  "coverage": [{ "doc": "...", "sections": n, "placed": n, "pending": n }],
  "tour": [...],
  "questions": [...],
  "presentation": { "cameraShots": [...], "accentOverrides": {...}, "panelVariants": {...} },
  "searchIndex": [...]
}
```

JSON only. Every ref must resolve (new ids you define included). Scene content
language: {{CONTENT_LANGUAGE}}.
