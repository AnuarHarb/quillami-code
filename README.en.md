# Quillami Code

*[Español](README.md)*

A coding agent for your terminal, born on the **Colombian Caribbean coast**: sun, palms, sea, a coastal Spanish line, then code in whatever repo you are in.

Not a chatbot—a loop: you assign work, the model calls tools, Quillami runs them (with permission when disk is involved) until the job is done.

TypeScript, MIT, no orchestration frameworks. This repo is the agent and a blueprint to build one.

## Features

- Read, search, list, edit, write files in the workspace
- Run shell commands (with permission)
- Project memory: `QUILLAMI.md` or `AGENTS.md` (also reads legacy `KILLAMI.md`)
- Global memory under `~/.quillami`: `soul.md`, `user.md`, `behaviors.md`
- History compaction around ~20k tokens
- Anthropic + MiniMax models; `/model` to switch

The workspace is the directory you launch `quillami` from.

## Requirements

- Node 22+
- [Anthropic](https://console.anthropic.com/) and/or [MiniMax](https://platform.minimax.io/) API key

## Install

```bash
npm install -g quillami-code
```

Commands: **`quillami`** or **`quillami-code`**. Or `npx quillami-code`.

On first run, missing keys are prompted (hidden input) and saved to `~/.quillami/.env`. Legacy `~/.killami/.env` is still loaded for unset variables.

```bash
cd ~/your-project
quillami
```

## Usage

Type at the `>` prompt. `/exit` quits. Sensitive tools ask **s / n / a** (once, no, always this session). `/undo` restores files from the last turn’s `write`/`edit`.

Slash commands: `/model`, `/login`, `/memory`, `/projects`, `/usage`, `/undo`.

## Models

See the alias table in [README.md](README.md). Default env: `QUILLAMI_MODEL` (legacy `KILLAMI_MODEL` supported).

## Memory

- **Global** (`~/.quillami/`): agent identity (`soul.md`), user profile (`user.md`), interaction rules (`behaviors.md`), plus `projects.json` (CLI registry).
- **Repo**: `QUILLAMI.md` / `AGENTS.md` for team conventions.

Agent updates global files via `remember_user` (permission required).

## Develop

```bash
npm install
npm start
npm test
npm run build
```

## License

[MIT](LICENSE) © Anuar Harb
