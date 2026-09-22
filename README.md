# Quillami Code

*[English](README.en.md)*

Agente de código en la terminal, nacido en el **Caribe colombiano**: sol, palma, mar, una frase costeña y a programar en el repo donde estés.

No es un chatbot. Es un loop: tú das la tarea, el modelo pide herramientas, Quillami las ejecuta (con permiso si toca disco) y repite hasta terminar.

TypeScript, MIT, sin frameworks de orquestación. Este repo es el agente y un lugar para armar uno desde cero.

## Qué hace

- Lee, busca y lista archivos del workspace
- Edita y escribe código
- Corre comandos en la carpeta actual
- Pregunta antes de `write`, `edit`, `bash` y `remember_user`
- Memoria de repo: `QUILLAMI.md` o `AGENTS.md` (también lee `KILLAMI.md` si migraste)
- Memoria global en `~/.quillami`: `soul.md`, `user.md`, `behaviors.md`
- Compacta el historial cuando la sesión crece (~20k tokens)
- Modelos Anthropic y MiniMax; cambio al vuelo con `/model`

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

Permisos para acciones sensibles:

```text
  s  sí, solo esta vez
  n  no
  a  sí, y no preguntar más en esta sesión
```

`/undo` restaura archivos tocados por `write`/`edit` en el último turno (no deshace `bash`).

Comandos útiles: `/model`, `/login`, `/memory`, `/projects`, `/usage`, `/undo`.

## Modelos

```bash
quillami --model haiku
quillami -m minimax
```

| alias | modelo | proveedor |
|-------|--------|-----------|
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
src/index.ts         CLI
src/config.ts        nombre, ~/.quillami, QUILLAMI.md
src/agent/loop.ts    loop modelo → tools
src/userMemory.ts    memoria global
src/memory.ts        memoria de repo
src/tools.ts         read write edit bash grep glob ls remember_user
test/                harness
evals/               tareas con API real
```

## Tests y CI

```bash
npm test          # sin API key
npm run eval      # con ANTHROPIC_API_KEY
```

GitHub Actions: typecheck, tests, build; evals opcionales si hay secret.

## Roadmap

- Prompt caching en el loop
- Sandbox real (p. ej. Firecracker), no solo consentimiento
- Cliente MCP
- Subagentes
- Reintentos ante 429
- Más evals con pass rate por modelo
- Sesiones persistentes (`--continue`)

Issues y PRs bienvenidos.

## Licencia

[MIT](LICENSE) © Anuar Harb
