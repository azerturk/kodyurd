# Skill: Visual QA in Kodyurd

Use for changes to Studio, city composition, movement, diagrams, model placement, learning panels and offline export. Compare with the approved reference frames when available. Follow the area rules in [PlayCanvas](playcanvas.md) and [Tripo](tripo.md).

## Establish a comparable baseline

- Record workspace and scene revision, viewport, browser and graphics mode, device pixel ratio, view ID and camera pose. Wait for the scene and requested GLBs to settle. Include the viewport around the result so controls, labels and overlap can be assessed.
- Use actual browser renders for regression comparisons. Compare pixels only within the same browser and graphics environment. Use concept boards to assess design choices. [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)
- Capture workspace list, empty setup, Settings, scan and brief, job progress and failure, city entry, overview, lobby, workshop, architecture, replay, Docs, Guide, assessment results, asset fallback and offline. Save motion clips for walking and branching, plus stills for composition and text.

## Review each frame and route

Score each item separately as pass, fail, or not applicable. For the owner review, set the required items before capture and target at least 9 of 10 applicable checks on each key frame. A clipped primary action, blocked route, unreadable required label, incorrect source, or unavailable equivalent keyboard action blocks acceptance regardless of visual score.

1. The main subject and action are clear in the first viewport.
2. Foreground, midground, and background establish depth and orientation.
3. Lighting, contact, palette, and materials match the surrounding scene.
4. Model scale, pivot, doors, floor contact and props fit the scene.
5. Titles, labels, links and data states have readable contrast and hierarchy.
6. Scene selection, direction and relationships are clear and stable.
7. Camera motion and overlays preserve location, context and focus.
8. Every important action works by keyboard and has a touch/direct alternative where relevant.
9. Layout fits at 320, 390, 768 and 1440 CSS px, including enlarged text and long labels.
10. The intended lesson content, interactions and evidence remain available in the exported view where supported.

Walk the same path at 30 and 60 FPS. Capture starts, stops, wall slide, reverse, strafe, diagonals, running and jump in outdoor and interior spaces. Record actual displacement, blocked collider, gait phase and camera distance if an apparent hitch occurs. Separate blocked movement from camera compression and animation slip.

For a changed model, compare front, profile, close and in-context views. Record role, dimensions, pivot, file size, texture budget, collision proxy, visible semantics and fallback. Check the offline model list uses the same role decision. Keep paid model submissions under the existing asset rules.

Verify keyboard focus return, 200% browser zoom, larger text, reduced motion, and an equivalent list for essential 3D interactions. Mark unsupported or unverified conditions in the audit record. [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [WAI modal patterns](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
