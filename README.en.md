# Quillami Code

*[Español](README.md)*

A coding agent for your terminal, born on the **Colombian Caribbean coast**: sun, palms, sea, a coastal Spanish line, then code in whatever repo you are in.

Not a chatbot—a loop: you assign work, the model calls tools, Quillami runs them (with permission when disk or network is involved) until the job is done.

TypeScript, MIT, no orchestration frameworks. This repo is the agent and a blueprint to build one.

## Features

- **`auto` mode:** Jev rates how hard each message is and Quillami uses the cheapest model that clears it, either across every OpenRouter model (by [Artificial Analysis](https://artificialanalysis.ai) benchmarks) or among four fixed models. `/usage` shows how much you save compared with always using Sonnet
- **OpenRouter** and Anthropic: hundreds of models with one key, with a list and search in `/model`
- Read, search, list, edit, and write files; run `bash` with permission
- **Diff before approval:** `write` and `edit` show the lines going out and coming in
- **Ctrl+C cancels the turn**, not the process: the session keeps going
- **`bash` with a per-call timeout** (2 min default, up to 30) and live output while it runs
- **ripgrep search** when installed (respects `.gitignore`), built-in search otherwise
- **Bounded output:** paged `read`; `bash` and MCP results keep head and tail
- **Prompt caching** on Anthropic and the OpenRouter models that support it
- **`web_fetch`:** public http/https URLs only; blocks private networks, localhost, redirects to them, and DNS that points inside
- **MCP:** `~/.quillami/mcp.json` (stdio or HTTP); tools as `mcp__server__tool`
- **Sessions:** `~/.quillami/sessions/`; `-c`, `--resume`, `quillami sessions`, `/sessions`, `/new`
- **Modes:** `agent`, `plan` (read-only + plan), `yolo` (auto-approve; denylist and Jev still apply)
- **One-shot:** `quillami "your task"` — one turn then exit (non-TTY denies risky tools unless `--yolo`)
- **`quillami doctor`:** Node, keys (including the benchmarks key), provider ping, Jev, MCP
- Project memory: `QUILLAMI.md` / `AGENTS.md` (legacy `KILLAMI.md`)
- Global memory under `~/.quillami` (`soul.md`, `user.md`, `behaviors.md`)
- History compaction around ~20k tokens
- **Jev (recommended):** [TypeSafe](https://typesafe.ai) — `auto` mode, auto-approval of harmless `bash`, and end-of-turn memory hints. Without a key everything works, with a fixed model

The workspace is the directory you launch `quillami` from.

## Requirements

- Node 22+
- An API key from [OpenRouter](https://openrouter.ai/keys) or [Anthropic](https://console.anthropic.com/) (one is enough)
- Recommended: a [Jev (TypeSafe)](https://typesafe.ai) key for `auto` mode
- Optional and free: an [Artificial Analysis](https://artificialanalysis.ai/api-reference) key so `auto` picks by benchmark
- Optional: [ripgrep](https://github.com/BurntSushi/ripgrep) (`brew install ripgrep`) for faster searches that respect `.gitignore`

## Install

```bash
npm install -g quillami-code
```

Commands: **`quillami`** or **`quillami-code`**. Or `npx quillami-code`.

```bash
cd ~/your-project
quillami
```

### First run

The first time you open Quillami (or whenever it finds no model key), it walks you through setup. **Two keys are recommended:** OpenRouter, for hundreds of models with one account, and Jev (TypeSafe), which automatically picks the best model for each task (`auto` mode). OpenRouter alone also works: you pin a model and switch it anytime with `/model`.

1. Pick the keys you want (recommended: `1 2`, OpenRouter and Jev; `4`, a free Artificial Analysis key, lets `auto` pick by benchmark). You need at least one model key (OpenRouter or Anthropic); the Jev key enables `auto`, smart permissions, and memory.
2. Paste each key; it is not shown on screen. Anthropic, OpenRouter, and Artificial Analysis keys are verified before saving: if the provider rejects one, it is not saved and you can try another.
3. Pick the model to start with: `auto` (recommended if you added the Jev key) or a fixed one (see [Picking a model](#picking-a-model)). It becomes your default.

Everything is saved to `~/.quillami/.env` and works from any folder. If you already had keys in the project's `.env` (which only work there), it offers to copy them.

Run it again with **`quillami setup`** or **`/setup`** inside a session. Legacy `~/.killami/.env` is still loaded for unset variables.

Develop in this repo: `npm install`, `npm start`, `npm run build`.

## Usage

Type at the `>` prompt. `/exit` or Ctrl+D quits.

Sensitive tools ask **s / n / a** (once, no, always this session). `a` covers only that tool: approving `bash` does not approve `write`. For MCP it covers the whole server (`mcp__easybits__*`), not other servers.

Before you approve a `write` or `edit`, you see the diff against the file on disk (red out, green in, up to 60 lines). If an `edit` would fail because its text is missing or appears more than once, the prompt says so. For `bash`, a non-default timeout is shown in the prompt.

`/undo` restores files from the last turn’s `write`/`edit` (it does not undo `bash`).

### Ctrl+C

| When | What it does |
|------|--------------|
| During a turn | Cancels the model call, the running `bash` (and its child processes), `web_fetch`, and MCP. You return to the prompt with the session intact |
| Again while cancelling | Exits Quillami |
| At the prompt | Clears the line; a second Ctrl+C within 2 s exits |

The cancelled turn stays in history with a note, because files it already touched stay touched. `/undo` still works. In one-shot mode, cancelling exits with code 130.

### Tools

| Tool | Notes |
|------|-------|
| `read` | Up to 2000 lines per call; `offset` and `limit` for long files (up to 5 MB). Lines over 2000 characters are cut |
| `write`, `edit` | Permission and diff. `edit` replaces text that must appear exactly once |
| `bash` | Permission. Per-call `timeout_seconds` (default 120, max 1800). Shows the last lines while running, then a summary such as `exit 0 · 3.1 s · 10 líneas` (the CLI speaks Spanish). The model gets the head and tail of the output |
| `grep` | `rg` when on PATH (respects `.gitignore`, includes dotfiles, skips `node_modules`, `.git`, `dist`); built-in search when it is missing or the pattern needs JavaScript-only syntax (lookbehind). Max 50 matches. `QUILLAMI_RG=off` forces the built-in search |
| `glob`, `ls` | No permission needed |
| `web_fetch` | Permission. Checks every redirect and the IP it actually connects to. Text, up to 20k characters |
| `remember_user` | Permission. Writes under `~/.quillami` |

Every tool result is cut to 30k characters before it reaches the model, keeping the start and end.

Slash commands: `/model`, `/models <text>`, `/setup`, `/mode`, `/login`, `/login typesafe`, `/memory`, `/projects`, `/sessions`, `/new`, `/mcp`, `/usage`, `/undo`.

```bash
quillami "fix the test"       # one shot
quillami -c                   # continue last session in this cwd
quillami --resume <id>
quillami sessions
quillami --plan               # read-only + plan
quillami --yolo "run tests"   # auto-approve (denylist/Jev still apply)
quillami doctor
quillami mcp
quillami models qwen coder    # search OpenRouter models
quillami setup                # add or change keys and the default model
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
- **`auto` model:** Jev scores how hard your message is and the code picks the model (see below).
- **Memory:** after a turn without `remember_user`, Jev may suggest one line for `user.md` or `behaviors.md` (you confirm y/n). The current model drafts the line, OpenRouter models included.

Permissions and memory work the same with any model: Jev judges the command or your message, not the model.

Key: `/setup` (option 2), `/login typesafe`, or `TYPESAFE_API_KEY`. Disable with `QUILLAMI_JEV=0`. Jev token counts appear in `/usage`.

### The `auto` model

On each message, Jev rates how hard your request is (trivial, standard, hard, or very hard) and Quillami picks the model. Which models it picks from depends on your keys:

| Keys | Picks from |
|------|------------|
| Jev + OpenRouter + Artificial Analysis | Every OpenRouter model with tools: the cheapest one that clears the bar, by benchmark |
| Jev + OpenRouter | DeepSeek V4.1 Flash (trivial), MiMo V2.6 Pro (standard), Claude Sonnet 5.5 (hard), or Claude Opus 5.5 (very hard) |
| Jev + Anthropic | Claude Haiku, Sonnet, or Opus directly |
| No Jev | The standard model on every message (MiMo V2.6 Pro, or Sonnet 4.5 with Anthropic) |

With a Jev key and no saved model, Quillami starts in `auto`. Before each answer you see what it picked (the CLI speaks Spanish):

```text
· jev · trivial → DeepSeek V4.1 Flash · $0.03 / $0.50 por M
```

#### With benchmarks

With `ARTIFICIAL_ANALYSIS_API_KEY` (free at [artificialanalysis.ai](https://artificialanalysis.ai/api-reference)), `auto` compares the [Artificial Analysis](https://artificialanalysis.ai) intelligence index of every OpenRouter model with tools and at least 128k context, and uses the cheapest one that reaches the minimum for that difficulty:

| Difficulty (Jev) | Minimum index | Example today |
|------------------|---------------|---------------|
| Trivial | 60% of the best model | DeepSeek V4.1 Flash ($0.03 / $0.50 per M) |
| Standard | 80% | MiMo V2.6 Pro ($0.44 / $0.87) |
| Hard | 95% | Claude Sonnet 5.5 ($2 / $10) |
| Very hard | 100% (the best) | Claude Opus 5.5 ($4 / $20) |

"Very hard" costs twice as much as "hard" for a small gain on the index, so it only kicks in when Jev is fairly sure: designing a whole system, a subtle bug across many modules, or a migration. A multi-file refactor is still "hard".

- The minimum is relative to the best available model, so it adjusts itself when new models ship.
- "Cheapest" is OpenRouter's blended price: 3 parts input to 1 part output.
- Benchmarks are cached in `~/.quillami/artificial-analysis.json` and refreshed once a day (about 4 of the free tier's 100 daily requests). If the API doesn't respond, it uses the last cache; with no cache, the four fixed models.
- The data is yours, fetched with your key: Artificial Analysis's free-tier terms don't allow redistributing it, so Quillami bundles no copy.
- To limit `auto` to some vendors, set `QUILLAMI_AUTO_VENDORS=anthropic,openai,google` in `~/.quillami/.env`. The minimum is then relative to the best model from those vendors.

#### It does not switch models for nothing

Switching models loses the prompt cache. A harder message always switches: quality comes first. An equal or easier one compares the cost of staying on the current model (reading from its cache) with sending the whole context uncached to the new one, and keeps the cheaper option (`· jev · trivial → sigue con Claude Opus (su caché sale más barato)`). After 5 idle minutes the cache has expired and it picks freely again.

#### What you save

`/usage` lists the models `auto` used this session and what Sonnet would have cost for every message:

```text
  auto     DeepSeek V4.1 Flash ×2 (índice 39.5)
           $0.0005 vs $0.0035 con Claude Sonnet siempre (ahorro 86%)
           benchmarks: Artificial Analysis (artificialanalysis.ai)
```

#### What about Jev Router?

OpenRouter offers [Jev Router](https://openrouter.ai/typesafe/jev-router) (`/model typesafe/jev-router`), which picks from the whole catalog. You can pin it, but it takes no criteria: it sees Quillami's system prompt and tools, not just your message, and in one test it sent "just say hi" to `openai/gpt-6-astra` ($10 / $50 per million). That is why `auto` uses local Jev.

## Models

### Picking a model

Type **`/model`** to get a numbered list: `auto` first, then Claude direct models (only with an Anthropic key; otherwise Claude is already in the OpenRouter section), then OpenRouter's featured models. The featured list is OpenRouter's `~…-latest` aliases, which always point at the newest model of each family, so it never goes stale.

- **A number** picks from the list.
- **Free text** (e.g. `qwen coder`, `kimi`, `gemini flash`) searches the whole OpenRouter catalog, newest first, and shows a new numbered list.
- **An alias or id** (`haiku`, `qwen/qwen3-coder`) is used directly.
- **`/models <text>`** opens the list already filtered.

If the model needs a key you do not have yet, Quillami asks for it right there. At the end it asks whether to make it your default (`QUILLAMI_MODEL` in `~/.quillami/.env`).

| alias | model | provider |
|-------|--------|-----------|
| `auto` | The cheapest model that clears each message (see [The `auto` model](#the-auto-model)) | OpenRouter or Anthropic (+ Jev) |
| `sonnet` | Sonnet 5 | Anthropic |
| `sonnet-4.5` | Sonnet 4.5 | Anthropic (default with Claude) |
| `opus` | Opus 5 | Anthropic |
| `fable` | Fable 5.1 | Anthropic |
| `haiku` | Haiku 4.5 | Anthropic |
| `openrouter` | Sonnet 5 (`anthropic/claude-sonnet-5`) | OpenRouter |
| `vendor/model` | any model in the catalog | OpenRouter |

Default: `--model` → `QUILLAMI_MODEL` → legacy `KILLAMI_MODEL` → `ANTHROPIC_MODEL` → `auto` when there is a Jev key → Sonnet 4.5 (or Sonnet 5 through OpenRouter without `ANTHROPIC_API_KEY`).

### OpenRouter

One key ([openrouter.ai/keys](https://openrouter.ai/keys)) reaches hundreds of models: Claude, GPT, Gemini, Qwen, DeepSeek, Kimi, GLM, and more. Quillami talks to OpenRouter's Anthropic-compatible endpoint, so tools, streaming, and caching work the same way.

- **Key:** option 1 in `quillami setup` (or on first run), `/login openrouter`, or `OPENROUTER_API_KEY` in `~/.quillami/.env`
- **Pick a model:** `/model` (list and search) or any id with a slash, e.g. `/model qwen/qwen3-coder-next` or `quillami -m qwen/qwen3-coder`. Ids starting with `~` (such as `~openai/gpt-sol-latest`) always point to the newest version
- **Search without a session:** `quillami models` shows the featured models; `quillami models qwen coder` searches. Price per million tokens and context size. Only models that accept tools are listed
- **Validation:** before using an id, Quillami looks it up in the catalog. If it does not exist, it suggests close matches without spending a request; if it exists but has no tool support, it warns
- **Pricing:** the public catalog is cached in `~/.quillami/openrouter-models.json` (refreshed every 24 h; the stale copy is used offline). It feeds the prices shown in lists; routers show as "precio variable"
- **Custom endpoint:** `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api`)

- **Real spend:** OpenRouter reports what it billed on every response, and Quillami uses that instead of estimating from the catalog
- **Served model:** when OpenRouter answers with a different model than requested (a `~…-latest` alias, `auto` through OpenRouter, or Jev Router), Quillami shows it

Each provider only receives its own key: your `ANTHROPIC_API_KEY` is never sent to OpenRouter.

## Memory

- **Global** (`~/.quillami/`): `soul.md`, `user.md`, `behaviors.md`, `projects.json`
- **Repo:** `QUILLAMI.md` / `AGENTS.md`

Agent updates global files via `remember_user` (permission required).

## Tokens and cost

Per-turn token line and USD estimate. `/usage` shows the turn, the session, and lifetime totals (`~/.quillami/usage.json`); with `auto`, also which models it used and what you saved compared with Sonnet.

Quillami sets cache breakpoints on the tools, the system prompt, and the last message, so most of a long conversation's prompt comes from cache. The token line shows it: `10k in (90% de caché)`. Cost counts cache writes at 1.25× and cache reads at 0.1× the input price. On OpenRouter nothing is estimated: Quillami uses what OpenRouter says it billed.

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
