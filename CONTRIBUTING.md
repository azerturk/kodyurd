# Contributing

Fork the repository on GitHub, clone your fork and create a branch for your change. Run these commands from the repository root.

~~~sh
npm ci
npm run build
npm test
~~~

Use `examples/harbor-desk` or a small synthetic fixture to reproduce issues. Include the failing input or behavior and keep credentials, private workspaces, logs and generated city data local. For visual changes, inspect the live viewer and its offline export from a cold load with the bundled models. [Architecture overview](docs/ARCHITECTURE.md) · [Workspace guide](docs/USAGE.md)

## AI-assisted development

`AGENTS.md` describes project-wide development rules. The guides in `packages/scene-schema`, `packages/server` and `packages/ui` apply to those packages. `CLAUDE.md` imports the shared guide for Claude Code. Keep personal assistant settings, sessions and credentials local, including `.claude/`, `.codex/` and `CLAUDE.local.md`. [Shared guide](AGENTS.md) · [Claude Code instructions](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools)

`packages/server/prompts/` contains the runtime prompts Kodyurd uses to request Scene JSON from providers. Treat changes there as application changes. The [runtime agent guide](docs/skills/agents-runtime.md) explains the evidence packet, validation and runner settings.
