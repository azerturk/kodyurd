# Publishing Kodyurd on GitHub

## Prepare the public tree

In a maintainer checkout, run:

~~~sh
node scripts/prepare-public-release.mjs github-ready
~~~

The command creates a new `.kodyurd-public/github-ready` directory. It checks the source allowlist, copies the application and the Harbor Desk example, and validates the bundled models. Use a new release name to build another candidate.

Open the generated directory. It already contains the public GLBs under `packages/assets/models/` and their matching `packages/assets/manifest.json`. Keep them together. The public manifest records each model's role, file, byte count, checksum and license. See the [model notice](../packages/assets/README.md).

## Review and push

Create an empty GitHub repository and copy its remote URL. Open a terminal in the generated public directory, then run:

~~~sh
git init -b main
git add --all
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git ls-files 'packages/assets/models/*.glb'
~~~

Check that the staged tree contains the application source, public docs, Harbor Desk source, and bundled GLBs. The release ignores local credentials, caches, workspace databases, logs, personal models and private agent settings. `AGENTS.md`, `CLAUDE.md`, and `packages/server/prompts/` are shared contributor and runtime files.

Once the staged list is correct, replace `OWNER` and `REPOSITORY` below and push:

~~~sh
git commit -m "Publish Kodyurd source"
git remote add origin "https://github.com/OWNER/REPOSITORY.git"
git push -u origin main
~~~

The current model files fit in regular Git. [GitHub source import](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github) · [GitHub file size limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

After the push, clone the repository into a fresh directory and follow the [README](../README.md) to verify setup and the Harbor example. Contributors can build and test locally with the same commands. [Contributing](../CONTRIBUTING.md)
