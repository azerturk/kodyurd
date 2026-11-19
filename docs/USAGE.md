# Using Kodyurd

1. Start Kodyurd from the repository and open the **Workspaces** screen.
2. In **Settings**, choose an installed and authenticated Claude Code or Codex CLI, or save an Anthropic API key. **Check connection** verifies the Anthropic key.
3. Add a readable local folder. Check the scan summary, discovered modules and reported limits. The scan indexes Markdown, MDX, reStructuredText and AsciiDoc documents with their Mermaid blocks, tables and step lists.
4. Write a brief with the audience, the part of the project to explain and any specific questions. For example, *Help a new maintainer understand the input validation and output of this package. Use tests where available.*
5. Select the content language, provider and optional model override. Enable **Review the plan before building lessons** to choose buildings and additional views after planning; leave it off to build directly. Review the brief, then select **Generate**. The job groups deliverables by building and shows elapsed time.
6. Open the city. Use **Explore architecture**, **Diagrams**, **Replay scenario**, **Docs** or **Learn** depending on the content available. In walking view, use WASD to walk, the left and right arrows or the mouse to look around, and E to interact. Use **City map** for the overview.

The brief decides which buildings get a lesson: the focus first, then the other parts it asks about. One run teaches at least two buildings and up to ten; after a broader brief, **Build the remaining** adds the others. Pin a module in the discovered map to make sure it is included.

**Stop generation** stops further work and keeps accepted deliverables and the saved city. **Resume generation** continues from a compatible saved checkpoint, reusing results whose evidence is unchanged. A reviewed plan keeps the focus and pinned buildings, and accepts up to ten buildings with four additional views each. If its planning evidence changes while it waits, generate a new plan.

A lesson always has a component map and, for running code, a replay. Ask in the brief for more views of a building: a sequence diagram, a state machine, a decision table, a data model, a class diagram, a mind map or a system context diagram. Each one is drawn only from cited source.

Mermaid blocks in the documents open as walkable diagrams too: flowcharts, sequence, state, entity and class diagrams, C4 diagrams, mind maps, and Gantt, journey and timeline charts. A block with syntax Kodyurd does not fully support stays readable as text in **Docs**.

In **City map**, district colors match the legend and open-book roof markers identify buildings with lessons. The overview shows a bounded set of source-linked connections; select a building to see its neighborhood, or use the directory for a specific connection and its full name. **Hide details** folds a diagram or replay's side panel while leaving playback controls available. **Show details** brings the panel back.

## Edit, draw and exchange diagrams

Open a diagram and select **Edit diagram** to correct it: rename items, change groups and roles, edit fields, and add or remove items and links. Preview the result before saving, use **Undo** or **Redo**, and review changes before restoring or discarding them. Unchanged meanings keep their source citations and Explain claims. Changed labels, fields or relationships do not inherit evidence merely because their IDs remain the same; additions also carry no citations. The diagram is marked as edited in this workspace. **Restore the generated diagram** returns to what was generated.

In **Diagrams**, **Draw or import a diagram** starts a new component map, sequence, state machine, data model, class diagram, mind map, timeline or layer map, or reads one from pasted Mermaid text or a diagrams.net (`.drawio`) file. From a `.drawio` file Kodyurd reads the first page: shapes, connectors, labels and containers. Your diagrams are kept beside the generated city, so a new generation keeps them, and **Export bundle** includes them. A workspace keeps up to forty.

The editor's **Copy as Mermaid** and **Download .drawio** work for any diagram. Format limitations appear before export; source citations and Explain claims stay in Kodyurd. Guide context includes the diagrams and corrections visible in the open city, treating user-authored additions as context rather than source evidence.

For an architecture-focused brief, include “architecture only”. For a replay, describe the input, branch or outcome you want to learn. A design document can be explored as a proposal. A small function can be illustrated by a single verified input-to-output path.

Each brief keeps its latest city. **Saved cities** on the workspace page lists them; **Open** returns to one without generating again, and **Remove** forgets a city that is not the open one. The list holds the twelve most recent briefs.

Use **Re-scan** after source changes. **Check saved explanations** identifies changed claim evidence, including claims retained in corrected diagrams. **Clear generation cache** clears the cached scan and lessons while keeping the saved city. **Remove workspace** removes Kodyurd's local workspace entry and its generated data. Source files stay on disk.

## Harbor Desk walkthrough

In **Workspaces**, select **Add workspace** and paste the full path to `examples/harbor-desk` from your clone. Use this brief for a first run.

> Focus on reservations. Show how a request becomes a confirmed reservation or is rejected when a booking overlaps. Trace the notification from the outbox to the local mailbox, including a retry after the first attempt fails. Cite the source and tests.

Open the generated city and use **Diagrams** to find the data model, **Replay scenario** to step through available behavior, and **Docs** to open the architecture notes. Generation uses the sample source on disk. Start Harbor Desk separately if you want to submit reservations in its own browser UI. [Harbor Desk instructions](../examples/harbor-desk/README.md)

## Export

Choose **Export bundle** from a workspace with a saved city. The ZIP includes the referenced GLBs and visible overlays. Unzip the bundle and serve it with a static HTTP server, such as `python -m http.server` if Python is installed. The extracted bundle retains walking, diagrams, replay and learning. Source reading and Guide Q&A use the local app.

## Troubleshooting

- Use `npm run doctor` to check Node, provider commands and the local environment.
- If a provider is unavailable, check that its CLI is installed and authenticated, or verify the Anthropic key from Settings.
- If the job is partial, open its details to see the missing deliverable or source coverage. Retry after adjusting the brief or source scan.
- If an editor cannot open directly, use **Copy path:line** or **Copy path** in Source Inspector.
- If the opening models take too long to load, use **Retry**. The city uses a built-in visual for a missing or invalid model.
