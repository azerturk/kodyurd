# Skill: Tripo overlay pipeline

Applies to the personal model pipeline in `packages/server/src/tripo.ts`.
A paid submit may happen at most once per intent, even across crashes.

## Receipts and recovery

1. Hash the prompt to get the intent and cache key. Reuse a valid cached GLB.
2. Reserve the exclusive claim and persist a `submitting` receipt before calling Tripo.
3. Record the returned task ID and change the receipt to `submitted`.
4. Poll for completion, validate the GLB and publish it from a temporary file. Mark the receipt `ready`.
5. Reconcile an ambiguous submit with its task ID when one is available. Keep a submit with an unknown result blocked. A documented request rejection can permit another click and attempt.

Keep claims and receipts together. Timeouts, lost responses, malformed responses and server errors can leave the outcome unknown. [Tripo error handling](https://developers.tripo3d.ai/en/docs/error-handling)

## Requests and model scope

- `generateOverlayModel(dataDir, prompt, onProgress)` uses the user's key to generate one offered landmark, centerpiece, emblem or icon per click. Character models require a rig and animations supplied through a local pack. [Model guide](../ASSETS.md)
- The global v3 endpoint is `https://openapi.tripo3d.ai/v3`. The runtime submits `P2-20260801` to `/generation/text-to-model` and polls `/tasks/{id}` every five seconds within an eight-minute polling budget. [Tripo P Series](https://developers.tripo3d.ai/en/docs/generation-text-to-model/p)
- Use `findGlbUrl` to find the model download. Verify the GLB magic bytes, version, declared length and 40 MiB limit. Keep the task ID available for recovery.
- Serve cached overlays locally at `/api/projects/:id/assets/:hash.glb`. The offline exporter copies referenced models into its own `models/` directory with relative URLs.

## Keys

`getTripoKey(dataDir)` reads `TRIPO_API_KEY` first and then
`~/.kodyurd/config.json`. Send the key only to Tripo. Keep credentials out of
logs, receipts and source control.
