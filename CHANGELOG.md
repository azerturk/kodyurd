# Changelog

Notable changes to Kodyurd, newest first.

## Unreleased

## 0.7.0

### Added

- **Lessons follow the brief.** The city plan lists the buildings a brief asks about and each one gets a lesson: at least two buildings, up to ten in one run, and **Build the remaining** adds the rest.
- **Generation controls.** Stop a generation and resume from its accepted work. An optional plan review lets you select lessons and additional views before their generation starts; the saved plan survives a restart and checks its evidence again before approval.
- **More lesson views.** A brief can ask for a data model, class diagram, mind map or system context diagram, beside the sequence diagram, state machine and decision table.
- **More Mermaid notations.** Class, C4, mind map, Gantt, journey and timeline blocks in workspace documents open as diagrams.
- **Diagram editor.** Correct a diagram, draw a new one, or import Mermaid text or a diagrams.net file. Preview changes, undo and redo, and review what changed before saving. Unsaved diagrams and edits are guarded when closing. Any diagram can be copied as Mermaid or downloaded as `.drawio`.
- **Correction notices.** A correction stays saved when its generated diagram changes or disappears. The live and exported viewer report the change, or explain when an older correction has no recorded original version.
- **City map.** District colors and a legend distinguish neighborhoods, open-book roof markers identify buildings with lessons, and a bounded set of connections keeps the overview readable.
- **Generation diagnostics.** Job details group deliverables by building and show elapsed time. Failed jobs can copy a small diagnostic report without prompts, file paths, credentials or raw logs.
- **Saved cities.** Each brief keeps its latest city, and an earlier one opens again without a new generation.
- **More sources.** MDX, reStructuredText and AsciiDoc documents are indexed beside Markdown, and the scan counts more languages, among them Swift, Dart, Scala, Elixir, Lua and Zig.
- **Interiors and entrances.** Lobbies have a reading corner, a floor directory and a learning trophy; a banner marks each building that has a lesson. The model pack has 86 models.
- **Keyboard look.** The left and right arrow keys turn the view.

### Changed

- Node.js 22.13 or newer is required for the standard installation. CLI checks verify the isolation capabilities used by generation, and the UI typecheck runs as part of the build.
- The viewer, Guide and static export read the same composition of generated diagrams, document imports and saved corrections.
- Diagram and replay details can be collapsed to give the scene more room. Readable physical nameplates replace duplicate floating labels; building names take priority over overview connection labels.
- Every diagram kind opens on the walkable 3D stage, including layer maps and timelines.
- A focused city keeps its campus layout for up to 24 buildings, up from 12.
- Code excerpts in Go, Rust, Swift, Kotlin and similar languages open at the declaration.
- The left and right arrow keys no longer step sideways; use A and D.

### Fixed

- Stopping prevents new lesson requests, cancels in-flight requests where supported, and preserves accepted work. An approved plan remains resumable even if stopped before its first checkpoint is written.
- City and model-offer publication share a cancellation boundary, keeping their revisions together when a generation stops or a city replacement fails.
- Diagram saves preserve self-loops, class multiplicity and field metadata. Changed relationships and other changed meanings cannot inherit assertions or citations from retained identifiers; freshness checks run after corrections are applied.
- Mermaid and diagrams.net interchange preserves supported graph structure, including colliding names, deep mind maps and self-links, and reports notation limitations.
- Building file, line and document counts come from the local scan rather than agent estimates.
- Questions from different lessons retain distinct, stable identities. City-wide question and tour limits select across buildings and report omitted entries. Exam progress checks question content before reusing an answer; older unversioned progress may reset.
- Health responses use the package version when the server starts without a CLI-supplied version.
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
