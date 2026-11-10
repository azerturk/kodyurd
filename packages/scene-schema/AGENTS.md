# AGENTS.md — packages/scene-schema

This package is the **security boundary**: runtime agents output only this JSON, and
`parseScene` (v0.1) / `parseSpace` (v0.2) are the gates. Nothing an agent writes may ever
become code.

Rules for this package:

- **Two living contracts.** `index.ts` = v0.1 (zones/items, legacy — frozen shape, keep it
  valid forever: old projects and static exports depend on it). `space.ts` = v0.2 "Space"
  (the knowledge city). `parseSpace` must keep accepting v0.1 documents and upgrading them
  city-only.
- **Additive-optional within a version.** New fields are optional with defaults; never
  repurpose or rename an existing field.
- **Bounded vocabularies only.** Icons, archetypes, accents, panel variants, camera
  angles/kinds, district kinds, flow kinds, diagram kinds, model classes — all closed
  enums exported as consts. Never accept free-form style strings from agents.
- **Refs must resolve.** Any new ref-carrying field needs a superRefine check (and the
  sanitizer in `packages/server/src/space-pipeline.ts` needs a matching repair/drop rule).
- **Agents never position anything.** Geometry fields belong to `layout-types.ts`
  (produced by deterministic layouters), never to agent-authored parts of the schema.
- **Change checklist** (from `docs/skills/scene-schema.md`): schema + prompt contract
  (`prompts/` + `SPACE_CONTRACT_NOTE`) + pipeline validation (CityPlan/BuildingPass) +
  layouters + live viewer + export viewer. A schema change that touches fewer than these
  is probably incomplete.
- **Export every named type that other packages' exported values can reach** (even
  indirectly through a zod schema's inferred type). A non-exported helper type here
  breaks the SERVER build with TS4023 ("…cannot be named") at declaration emit — and
  `--noEmit` typechecks won't show it, only the real `npm run build` does.
- When you add or widen a field, extend the matching deterministic normalizer in
  `packages/server/src/space-pipeline.ts` (`normalizeCityPlan` / `normalizeBuildingPass`)
  in the same change — otherwise agent answers start failing validation on trivia.
- NodeNext ESM: relative imports need `.js` suffixes. Build with
  `npx tsc -p packages/scene-schema/tsconfig.json` before typechecking the server.
