# Architecture

Kodyurd is a local app that turns read-only source evidence into one validated knowledge city.

1. **Scan.** The server inventories the selected folder and indexes relevant source, docs and diagrams with explicit bounds.
2. **Plan.** A provider creates a city plan and scoped learning deliverables from source evidence. Claude Code, Codex CLI and the Anthropic API share the Scene JSON contract.
3. **Validate.** The server normalizes bounded fields, validates with the scene schema, verifies sources and lays out the city. Invalid results remain visible as pending or failed deliverables.
4. **Render.** PlayCanvas renders one world from the same validated document and deterministic layout. Semantic roles resolve to installed models, with built-in geometry for missing or invalid files.
5. **Share.** Export uses the same viewer in offline mode with a portable city document, UI assets and the models used by the city.

| Package | Responsibility |
| --- | --- |
| `packages/scene-schema` | Scene JSON and layout contracts, compatibility |
| `packages/server` | Scan, evidence, providers, job state, validation, layout and export |
| `packages/ui` | Workspace Studio and PlayCanvas city |
| `packages/cli` | Local server startup and environment checks |
| `packages/assets` | Bundled GLB models and role manifest |

Agents return typed scene data. The product controls geometry, typography, animation and controls. Keep agent HTML, JavaScript, CSS and arbitrary asset URLs outside the scene contract. Retain compatibility with existing scene files when extending it.
