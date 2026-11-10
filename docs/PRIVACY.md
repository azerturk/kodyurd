# Privacy and network activity

Kodyurd binds its web server to `127.0.0.1`. Workspace configuration, scans, job records and cities live under `~/.kodyurd`. Kodyurd sends no telemetry. Workspace files are scanned read-only.

| Action | Destination and data |
| --- | --- |
| Generate a city or ask the guide | The selected AI provider receives the user prompt and bounded workspace excerpts. |
| Check an Anthropic API connection | Anthropic receives the configured key for a model-list request. |
| Generate a personal model | Tripo receives the user's API key and the chosen model prompt. Its signed download URL supplies the result. |
| Run `npm ci` | npm downloads the dependencies pinned in the lockfile. |

Generation uses text for visual guidance by default. If you install optional reference images locally, supported generation calls may send an image to the selected provider.

## Workspace credentials

Before adding a workspace, review the selected folder for API keys, tokens, passwords and other credentials. Keep files that contain credentials outside the workspace or exclude them with the workspace's `.gitignore` before scanning.

Kodyurd's scanner and evidence reader skip known credential files such as `.env`, `.env.*`, `.npmrc`, `.netrc`, and private-key files ending in `.pem` or `.key`. These exclusions use file names and paths. A key written directly in ordinary source code or a README can still be included in an excerpt sent to your selected provider. Move such values into environment variables or a separate excluded file.

By default, CLI agents receive the prepared evidence and run in a separate working directory. The optional `KODYURD_WORKSPACE_DISCOVERY=1` setting lets CLI agents read files directly, outside Kodyurd's evidence filter. Enable it only for folders you have reviewed and intend to share with the provider. Provider authentication, processing and billing follow your own provider account.

API keys can be provided through environment variables or stored locally in `~/.kodyurd/config.json`. Environment variables take precedence. The app displays configuration status and key names. Export bundles include the generated city text and relative source references. A bundle can include personal GLB files. Review those contents before sharing.
