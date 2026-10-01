# Quillami Code

*[English](README.en.md)*

Agente de código en la terminal, nacido en el **Caribe colombiano**: sol, palma, mar, una frase costeña y a programar en el repo donde estés.

No es un chatbot. Es un loop: tú das la tarea, el modelo pide herramientas, Quillami las ejecuta (con permiso si toca disco) y repite hasta terminar.

TypeScript, MIT, sin frameworks de orquestación. Este repo es el agente y un lugar para armar uno desde cero.

## Qué hace

- Lee, busca, lista y edita archivos del workspace; corre `bash` con permiso
- **`web_fetch`:** descarga URLs públicas (http/https); bloquea redes privadas y localhost
- **MCP:** servidores en `~/.quillami/mcp.json` (stdio o HTTP); tools expuestas como `mcp__servidor__tool`
- **Sesiones:** historial en `~/.quillami/sessions/`; `-c`, `--resume`, `quillami sessions`, `/sessions`, `/new`
- **Modos:** `agent` (normal), `plan` (solo lectura + plan), `yolo` (auto-aprueba; denylist y Jev siguen)
- **One-shot:** `quillami "tu tarea"` — un turno y sale (sin TTY niega tools salvo `--yolo`)
- **`quillami doctor`:** Node, keys, ping al proveedor, Jev y MCP
- Memoria de repo: `QUILLAMI.md` / `AGENTS.md` (legacy `KILLAMI.md`)
- Memoria global: `~/.quillami` (`soul.md`, `user.md`, `behaviors.md`)
- Compactación del historial (~20k tokens)
- Anthropic + MiniMax; `/model` y alias `auto` (Jev)
- **Jev (opcional):** [TypeSafe](https://typesafe.ai) — permisos de `bash`, router `auto`, memoria al fin del turno. Sin key, igual que antes.

El workspace es la carpeta desde la que lanzas `quillami`, no necesariamente este repo.

## Requisitos

- Node 22+
- API key de [Anthropic](https://console.anthropic.com/) y/o [MiniMax](https://platform.minimax.io/)

## Instalar

```bash
npm install -g quillami-code
```

Sin instalar global: `npx quillami-code`. Comandos: **`quillami`** o **`quillami-code`**.

La primera vez que falte una key, el CLI la pide oculta y la guarda en `~/.quillami/.env`:

```bash
mkdir -p ~/.quillami
echo 'ANTHROPIC_API_KEY=tu_key' >> ~/.quillami/.env
# o
echo 'MINIMAX_API_KEY=tu_key' >> ~/.quillami/.env
```

Si vienes de Killami, `~/.killami/.env` sigue cargándose para variables que aún no estén en `~/.quillami`.

```bash
cd ~/tu-proyecto
quillami
```

Desarrollo en este repo: `npm install`, `npm start`. Tras cambiar código: `npm run build`.

## Uso

Escribes en el prompt. `/exit` cierra.

Permisos para acciones sensibles (`write`, `edit`, `bash`, `web_fetch`, `remember_user`, MCP):

```text
  s  sí, solo esta vez
  n  no
  a  sí, y no preguntar más en esta sesión
```

`/undo` restaura archivos tocados por `write`/`edit` en el último turno (no deshace `bash`).

Comandos útiles: `/model`, `/mode`, `/login`, `/memory`, `/projects`, `/sessions`, `/new`, `/mcp`, `/usage`, `/undo`.

```bash
quillami "explica este archivo"     # un turno y sale
quillami -c                         # continúa la última sesión en este repo
quillami --resume <id>              # retoma por id (/sessions)
quillami sessions                   # lista sesiones del cwd
quillami --plan                     # solo lectura + plan al final
quillami --yolo "corre los tests"   # auto-aprueba (denylist/Jev siguen)
quillami doctor                     # keys, ping al proveedor, Jev, MCP
quillami mcp                        # servidores MCP conectados
```

## Modos

| Modo | Flag / slash | Comportamiento |
|------|----------------|----------------|
| **agent** | (default) | Tools completas; permisos s/n/a |
| **plan** | `--plan`, `/mode plan` | Solo lectura; el modelo termina con un plan (sin write/bash/MCP) |
| **yolo** | `--yolo`, `/mode yolo` | Auto-aprueba tools; denylist en `bash` y bloqueos Jev siguen |

En plan, el prompt muestra `plan> `; en yolo, `yolo> `.

## Sesiones

Cada carpeta de trabajo guarda hasta **50** sesiones en `~/.quillami/sessions/<id>.json` (historial completo, escritura atómica).

- **`quillami -c`** — retoma la sesión más reciente de este `cwd`
- **`quillami --resume <id>`** — retoma por id (lista con `quillami sessions` o `/sessions`)
- **`/new`** — historial limpio, id nuevo (mismo cwd)
- **`--model`** al arrancar override el modelo guardado en la sesión

`/undo` solo afecta el turno actual (checkpoints no se persisten entre sesiones).

## MCP

Configura `~/.quillami/mcp.json`. Las variables `${NOMBRE}` se expanden desde el entorno (p. ej. `~/.quillami/.env`).

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

- **`url`** — Streamable HTTP
- **`command` + `args`** — servidor stdio (p. ej. `npx -y …`)
- **`enabled: false`** — desactiva un servidor
- **`tools`** — array opcional para limitar qué tools se exponen

Al arrancar, Quillami conecta en paralelo (timeout ~10s); fallos se anuncian y se sigue sin ese servidor. Banner: `mcp: easybits (N tools)`. Detalle: `/mcp` o `quillami mcp`.

## Decisiones con Jev

Jev no reemplaza a Claude: no escribe respuestas ni llama tools. El código le hace preguntas tipadas (Score/Noul) y aplica umbrales en TypeScript.

- **Permisos:** `bash` de solo lectura con alta confianza puede auto-aprobarse; comandos muy riesgosos se bloquean; `write`/`edit` siguen pidiendo siempre. Denylist fija (`sudo`, `rm -rf`, `git push`, etc.) nunca auto-aprueba.
- **Modelo `auto`:** Jev estima complejidad del mensaje y elige Haiku, Sonnet u Opus (solo con `ANTHROPIC_API_KEY`).
- **Memoria:** si el turno no usó `remember_user`, Jev puede proponer una línea para `user.md` o `behaviors.md` (tú confirmas s/n).

Key: `/login typesafe` o `TYPESAFE_API_KEY` en `~/.quillami/.env`. Apagar: `QUILLAMI_JEV=0`. Uso de Jev en `/usage` (tokens, sin USD).

## Modelos

```bash
quillami --model haiku
quillami -m minimax
```

| alias | modelo | proveedor |
|-------|--------|-----------|
| `auto` | Haiku / Sonnet / Opus por turno | Anthropic (Jev) |
| `sonnet` | Sonnet 5 | Anthropic |
| `sonnet-4.5` | Sonnet 4.5 | Anthropic (default con Claude) |
| `opus` | Opus 5 | Anthropic |
| `fable` | Fable 5.1 | Anthropic |
| `haiku` | Haiku 4.5 | Anthropic |
| `minimax` | MiniMax M3 | MiniMax |

Prioridad del default: `--model` → `QUILLAMI_MODEL` → `KILLAMI_MODEL` (legacy) → `ANTHROPIC_MODEL` → Sonnet 4.5 (o MiniMax si solo hay `MINIMAX_API_KEY`).

MiniMax: endpoint compatible Anthropic; opcional `MINIMAX_BASE_URL` (China: `https://api.minimaxi.com/anthropic`).

## Memoria

**Global** (`~/.quillami/`):

| Archivo | Contenido |
|---------|-----------|
| `soul.md` | Identidad de Quillami (el agente) |
| `user.md` | Lo que aprende sobre ti |
| `behaviors.md` | Cómo debe interactuar contigo |
| `projects.json` | Carpetas donde has abierto Quillami (CLI) |

El agente escribe los `.md` con la tool `remember_user` (con permiso). Tú puedes editarlos a mano.

**Proyecto** (en el repo): `QUILLAMI.md` / `AGENTS.md` — convenciones, comandos, qué no tocar. El agente usa `write` con permiso.

## Tokens y gasto

Cada turno muestra tokens y estimado en USD. `/usage` detalla; total acumulado en `~/.quillami/usage.json`.

## Arquitectura (breve)

```text
src/index.ts         CLI, REPL, one-shot
src/cli.ts           flags y subcomandos
src/agent/loop.ts    loop modelo → tools
src/toolRegistry.ts  builtin + MCP por modo
src/tools.ts         read write edit bash grep glob ls web_fetch remember_user
src/mcp.ts           cliente MCP (@modelcontextprotocol/sdk)
src/sessions.ts      persistencia ~/.quillami/sessions
src/permissions.ts   s/n/a, plan, yolo, Jev
src/jev.ts           cliente TypeSafe
src/decisions.ts     riesgo, router auto, memoria
src/doctor.ts        quillami doctor
test/                harness
evals/               tareas con API real
```

Más detalle en [QUILLAMI.md](QUILLAMI.md).

## Tests y CI

```bash
npm test          # sin API key
npm run eval      # con ANTHROPIC_API_KEY
```

GitHub Actions: typecheck, tests, build; evals opcionales si hay secret.

## Roadmap

- Prompt caching en el loop
- Sandbox real (p. ej. Firecracker), no solo consentimiento
- Subagentes
- Reintentos ante 429
- Más evals con pass rate por modelo
- Búsqueda web (hoy solo `web_fetch` de una URL)

Issues y PRs bienvenidos.

## Licencia

[MIT](LICENSE) © Anuar Harb
