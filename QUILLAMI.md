# Quillami Code

Agente de código en TypeScript. Los usuarios lo instalan con `npm install -g quillami-code`. El comando es `quillami` (o `quillami-code`). Aquí también vale `npm start`.

- Entrada: `src/index.ts` · args: `src/cli.ts`
- Config: `src/config.ts` — nombre, `~/.quillami`, `QUILLAMI.md`
- Loop: `src/agent/loop.ts` · tools: `src/toolRegistry.ts`, `src/tools.ts`
- Sesiones: `src/sessions.ts` — `~/.quillami/sessions/*.json`, `-c`, `--resume`, `/sessions`, `/new`
- MCP: `src/mcp.ts` — `~/.quillami/mcp.json`, tools `mcp__servidor__tool`, `/mcp`, `quillami mcp`
- Skills: `src/skills.ts` — carpetas con `SKILL.md` en `.quillami/skills`, `.claude/skills`, `.agents/skills`, `.cursor/skills` (proyecto y luego home; gana la primera por nombre; dedupe por realpath). Se descubren una vez al arrancar y viajan en el `ToolRegistry` (`skills`). El system prompt lleva solo nombre + descripción; la tool `skill` (solo lectura, sin permiso, también en plan) carga el cuerpo o un archivo de apoyo sin salir de la carpeta. `/nombre pedido` mete la skill en `modelInput`; Jev y la memoria siguen viendo lo que escribió el usuario. `disable-model-invocation: true` = fuera del índice, solo con `/nombre`
- Web: `src/webFetch.ts` — tool `web_fetch` (solo URLs públicas; valida cada redirección y la IP con la que conecta)
- Búsqueda: `src/ripgrep.ts` — `grep` usa `rg` si está; si no, búsqueda propia en `src/tools.ts`. `QUILLAMI_RG=off` la fuerza
- Salidas: `src/truncate.ts` — recorte cabeza/cola (30k por resultado de tool); `src/liveOutput.ts` — últimas líneas de `bash` en vivo
- Ctrl+C: `src/interrupt.ts` — cancela el turno con un AbortSignal que llega al stream, `bash`, `web_fetch` y MCP
- Diff: `src/diff.ts` — diff de `write`/`edit` en el prompt de permiso
- Caché: `src/agent/cache.ts` — `cache_control` en tools, system y último mensaje (sin tocar el historial)
- Modos: `src/mode.ts` — agent / plan / yolo (`--plan`, `--yolo`, `/mode`)
- Doctor: `src/doctor.ts` — `quillami doctor`
- Compactación: `src/agent/compact.ts` — si el historial pasa ~20k tokens, resume lo viejo y deja ~7k de cola
- Tokens: `src/usage.ts` — gasto por turno/sesión/total; `/usage`
- Modelos: `src/models.ts` — Anthropic y OpenRouter; cualquier id `vendor/modelo` va a OpenRouter; `quillami --model <alias>` o `/model`. MiniMax directo sigue funcionando con `MINIMAX_API_KEY` y `-m minimax`, pero no aparece en listas, onboarding ni docs
- Proveedores: `src/providers.ts` — cliente Anthropic SDK por proveedor; `apiKey` y `authToken` siempre explícitos para que el SDK no mande la key de Anthropic a otro proveedor
- OpenRouter: `src/openrouter.ts` — catálogo público cacheado 24 h en `~/.quillami/openrouter-models.json`, búsqueda (`/models`, `quillami models`) y precios por modelo
- `auto`: Jev local (`TYPESAFE_API_KEY`) puntúa la complejidad y `pickModelForComplexity` elige entre `autoTiers`: Haiku/Sonnet/Opus directo con `ANTHROPIC_API_KEY`, o con solo OpenRouter `OPENROUTER_TIERS` (DeepSeek V4.1 Flash, MiMo V2.6 Pro, Claude Sonnet 5.5, Claude Opus 5.5: elección nuestra, revisarla cuando cambien los benchmarks). Cuatro niveles: light/standard/heavy/max; `max` ("muy difícil") exige `COMPLEXITY_MAX_MIN_SCORE` 2.5 y confianza 0.8 porque cuesta el doble que heavy. `autoBaseline` (Sonnet) es contra lo que `/usage` mide el ahorro. Jev Router (`typesafe/jev-router`) es solo un modelo fijo: no acepta criterios.
- Con `ARTIFICIAL_ANALYSIS_API_KEY` + OpenRouter (`benchmarks.ts`), `complexityTier` da light/standard/heavy y `pickByBenchmark` elige el modelo de OpenRouter más barato (3:1 entrada:salida) cuyo índice de inteligencia supera `BENCHMARK_BARS` × el mejor del pool. Los slugs de AA usan guiones y un sufijo por esfuerzo (`gpt-6-1-sol-high`); `matchBenchmark` los empareja con ids de OpenRouter. Caché diaria en `~/.quillami/artificial-analysis.json`; si la API falla, `loadBenchmarks` usa esa caché vieja. No incluir datos de AA en el repo ni en el paquete: el tier gratis es solo uso interno y prohíbe redistribuirlos. Atribución obligatoria (`BENCHMARK_ATTRIBUTION`). `QUILLAMI_AUTO_VENDORS` filtra el pool por vendor.
- `stickToPrevious` (decisions.ts) mantiene el modelo del turno anterior si la dificultad no subió y leer de su caché cuesta menos que mandar el contexto sin caché al nuevo; `AUTO_CACHE_TTL_MS` (5 min). `usage.setAutoRoute` lleva por sesión los modelos de auto y el costo contra el tier estándar (Sonnet) para `/usage`. El loop lee de los eventos del stream el modelo servido (`message_start`) y `usage.cost` (`message_delta`), porque el SDK los descarta al armar el mensaje
- Listas interactivas: `src/select.ts` — flechas, espacio marca (checkbox), Enter sigue, Esc cancela, Ctrl+C interrumpe el turno. Lo usan onboarding, `/model`, permisos y confirmaciones (`confirm`). Solo con TTY (`interactiveTerminal`); sin TTY cada sitio cae al prompt escrito de antes. Mientras dibuja quita los listeners de `keypress` de readline y los devuelve al terminar
- Selector: `src/modelPicker.ts` — `/model` y `/models`: directos + alias `~…-latest` de OpenRouter; escribir filtra el catálogo en vivo
- Onboarding: `src/onboarding.ts` — primera vez (sin `~/.quillami/onboarding.json` o sin key de modelo), `quillami setup`, `/setup`; verifica keys de Anthropic y OpenRouter antes de guardar
- Keys: `src/auth.ts` — prompt oculto, guarda en `~/.quillami/.env`; `/login`, `/login openrouter`, `/login typesafe`
- Jev: `src/jev.ts` — cliente TypeSafe (`TYPESAFE_API_KEY`), timeout ~4s, fallback silencioso
- Decisiones: `src/decisions.ts` — riesgo de permisos, router `auto`, memoria al fin del turno
- Memoria global: `src/userMemory.ts` — `~/.quillami/soul.md`, `user.md`, `behaviors.md`, `projects.json`; `/memory`, `/projects`
- Permisos: `src/permissions.ts` — write/edit/bash/web_fetch/MCP/remember_user; s/n/a (la `a` es por tool, y por servidor en MCP); yolo y plan
- Checkpoints: `src/checkpoint.ts` — foto de `write`/`edit` por turno; `/undo` restaura. `bash` no se deshace.
- Banner: `src/banner.ts`
- Spinner: `src/spinner.ts`

One-shot: `quillami "tu prompt"` (un turno y sale). Sin TTY niega tools salvo `--yolo`.

Los tests del harness: `npm test`. Los evals del agente: `npm run eval` (necesitan API key). CI en `.github/workflows/ci.yml`. Después de cambiar el código, corre `npm run build` para que el comando `quillami` se actualice.

No commitear `.env`. La API key puede vivir en `.env` del proyecto o en `~/.quillami/.env`. Sigue leyendo `~/.killami/.env` si migras desde Killami.
