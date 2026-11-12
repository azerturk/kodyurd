# Changelog

Notable changes to Kodyurd, newest first.

## Unreleased

### Added

- **Lessons follow the brief.** The city plan lists the buildings a brief asks about and each one gets a lesson: at least two buildings, up to ten in one run, and **Build the remaining** adds the rest.
- **More lesson views.** A brief can ask for a data model, class diagram, mind map or system context diagram, beside the sequence diagram, state machine and decision table.
- **More Mermaid notations.** Class, C4, mind map, Gantt, journey and timeline blocks in workspace documents open as diagrams.
- **Diagram editor.** Correct a diagram, draw a new one, or import Mermaid text or a diagrams.net file. Any diagram can be copied as Mermaid or downloaded as `.drawio`.
- **Saved cities.** Each brief keeps its latest city, and an earlier one opens again without a new generation.
- **More sources.** MDX, reStructuredText and AsciiDoc documents are indexed beside Markdown, and the scan counts more languages, among them Swift, Dart, Scala, Elixir, Lua and Zig.
- **Interiors and entrances.** Lobbies have a reading corner, a floor directory and a learning trophy; a banner marks each building that has a lesson. The model pack has 86 models.
- **Keyboard look.** The left and right arrow keys turn the view.

### Changed

- Every diagram kind opens on the walkable 3D stage, including layer maps and timelines.
- A focused city keeps its campus layout for up to 24 buildings, up from 12.
- Code excerpts in Go, Rust, Swift, Kotlin and similar languages open at the declaration.
- The left and right arrow keys no longer step sideways; use A and D.

### Fixed

- A long replay that runs out of output space gets one larger retry.
- A replay for a very small module is asked for its call and its result, so it has the two steps a flow needs.

### Removed

- The `KODYURD_P2_LIMIT`, `KODYURD_P2_CONCURRENCY` and `KODYURD_FULL_INTERIORS` environment variables. The brief and the lesson bounds decide how many buildings get a lesson.

## 0.6.0

First public release.

- Scan a local workspace and generate a walkable 3D city of its modules.
- Component, behavior and data diagrams with source citations, including flowchart, sequence, state and entity diagrams imported from Mermaid.
- Scenario replays backed by source and tests.
- Documents and evidence open in the city or at a validated line in your editor.
- Guide Q&A, tours, practice and exams.
- Export a static city bundle.
- Generation with Claude Code, Codex CLI or the Anthropic API, 85 bundled models, and optional Tripo models for personal overlays.
