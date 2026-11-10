# Using Kodyurd

1. Start Kodyurd from the repository and open the **Workspaces** screen.
2. In **Settings**, choose an installed and authenticated Claude Code or Codex CLI, or save an Anthropic API key. **Check connection** verifies the Anthropic key.
3. Add a readable local folder. Check the scan summary, discovered modules and reported limits.
4. Write a brief with the audience, the part of the project to explain and any specific questions. For example, *Help a new maintainer understand the input validation and output of this package. Use tests where available.*
5. Select the content language, provider and optional model override. Review the brief, then select **Generate**. The job reports the status of individual deliverables.
6. Open the city. Use **Explore architecture**, **Diagrams**, **Replay scenario**, **Docs** or **Learn** depending on the content available. In walking view, use WASD and E. Use **City map** for the overview.

For an architecture-focused brief, include “architecture only”. For a replay, describe the input, branch or outcome you want to learn. A design document can be explored as a proposal. A small function can be illustrated by a single verified input-to-output path.

Use **Re-scan** after source changes. **Clear generation cache** clears the cached scan and lessons while keeping the saved city. **Remove workspace** removes Kodyurd's local workspace entry and its generated data. Source files stay on disk.

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
