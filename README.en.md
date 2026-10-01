# Quillami Code

*[Español](README.md)*

A coding agent for your terminal, born on the **Colombian Caribbean coast**: sun, palms, sea, a coastal Spanish line, then code in whatever repo you are in.

Not a chatbot—a loop: you assign work, the model calls tools, Quillami runs them (with permission when disk or network is involved) until the job is done.

TypeScript, MIT, no orchestration frameworks. This repo is the agent and a blueprint to build one.

## Features

- Read, search, list, edit, and write files; run `bash` with permission
- **`web_fetch`:** public http/https URLs only; private networks and localhost blocked
- **MCP:** `~/.quillami/mcp.json` (stdio or HTTP); tools as `mcp__server__tool`
- **Sessions:** `~/.quillami/sessions/`; `-c`, `--resume`, `quillami sessions`, `/sessions`, `/new`
- **Modes:** `agent`, `plan` (read-only + plan), `yolo` (auto-approve; denylist and Jev still apply)
- **One-shot:** `quillami "your task"` — one turn then exit (non-TTY denies risky tools unless `--yolo`)
- **`quillami doctor`:** Node, keys, provider ping, Jev, MCP
- Project memory: `QUILLAMI.md` / `AGENTS.md` (legacy `KILLAMI.md`)
- Global memory under `~/.quillami` (`soul.md`, `user.md`, `behaviors.md`)
- History compaction around ~20k tokens
- Anthropic + MiniMax; `/model` and `auto` alias (Jev)
- Optional **Jev** ([TypeSafe](https://typesafe.ai)): bash risk, `/model auto`, end-of-turn memory hints. Without a key, unchanged behavior.

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

Develop in this repo: `npm install`, `npm start`, `npm run build`.

## Usage

Type at the `>` prompt. `/exit` quits. Sensitive tools ask **s / n / a** (once, no, always this session). `/undo` restores files from the last turn’s `write`/`edit`.

Slash commands: `/model`, `/mode`, `/login`, `/login typesafe`, `/memory`, `/projects`, `/sessions`, `/new`, `/mcp`, `/usage`, `/undo`.

```bash
quillami "fix the test"       # one shot
quillami -c                   # continue last session in this cwd
quillami --resume <id>
quillami sessions
quillami --plan               # read-only + plan
quillami --yolo "run tests"   # auto-approve (denylist/Jev still apply)
quillami doctor
quillami mcp
```

## Modes

| Mode | Flag / slash | Behavior |
|------|----------------|----------|
| **agent** | (default) | Full tools; s/n/a prompts |
| **plan** | `--plan`, `/mode plan` | Read-only; model ends with a plan |
| **yolo** | `--yolo`, `/mode yolo` | Auto-approve; bash denylist and Jev blocks remain |

Prompt prefix: `plan> ` or `yolo> ` when applicable.

## Sessions

Up to **50** sessions per working directory in `~/.quillami/sessions/<id>.json`.

- **`quillami -c`** — latest session for this cwd
- **`quillami --resume <id>`** — resume by id
- **`/new`** — fresh history, new id
- **`--model`** on startup overrides the model stored in the session

`/undo` checkpoints are not persisted across sessions.

## MCP

Example `~/.quillami/mcp.json` ( `${VAR}` expanded from env):

```json
{
  "servers": {
    "easybits": {
      "url": "https://www.easybits.cloud/api/mcp?tools=core",
      "headers": { "Authorization": "Bearer ${EASYBITS_API_KEY}" }
    }
  }
}
```

Use `command`/`args` for stdio servers; `enabled: false` and `tools: [...]` to filter. See `/mcp` or `quillami mcp` after connect.

## Jev decisions

Jev does not replace the LLM. Quillami asks typed questions (Score/Noul) and applies thresholds in code.

- **Permissions:** low-risk read-only `bash` may auto-approve; high-risk commands are blocked; `write`/`edit` always ask. A fixed denylist never auto-approves.
- **`auto` model:** Jev picks Haiku, Sonnet, or Opus per turn (Anthropic key required).
- **Memory:** after a turn without `remember_user`, Jev may suggest one line for `user.md` or `behaviors.md` (you confirm y/n).

Set `TYPESAFE_API_KEY` or `/login typesafe`. Disable with `QUILLAMI_JEV=0`. Jev token counts appear in `/usage`.

## Models

| alias | model | provider |
|-------|--------|-----------|
| `auto` | Haiku / Sonnet / Opus per turn | Anthropic (Jev) |
| `sonnet` | Sonnet 5 | Anthropic |
| `sonnet-4.5` | Sonnet 4.5 | Anthropic (default with Claude) |
| `opus` | Opus 5 | Anthropic |
| `fable` | Fable 5.1 | Anthropic |
| `haiku` | Haiku 4.5 | Anthropic |
| `minimax` | MiniMax M3 | MiniMax |

Default: `--model` → `QUILLAMI_MODEL` → legacy `KILLAMI_MODEL` → Sonnet 4.5 (or MiniMax if only `MINIMAX_API_KEY`).

## Memory

- **Global** (`~/.quillami/`): `soul.md`, `user.md`, `behaviors.md`, `projects.json`
- **Repo:** `QUILLAMI.md` / `AGENTS.md`

Agent updates global files via `remember_user` (permission required).

## Tokens and cost

Per-turn token line and USD estimate; `/usage` for session and lifetime totals in `~/.quillami/usage.json`.

## Develop and test

```bash
npm install
npm start
npm test
npm run build
npm run eval   # needs ANTHROPIC_API_KEY
```

See [QUILLAMI.md](QUILLAMI.md) for file-level map.

## License

[MIT](LICENSE) © Anuar Harb
