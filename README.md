# Quillami Code

*[English](README.en.md) · [Sitio web](https://anuarharb.github.io/quillami-code/)*

Agente de código en la terminal, nacido en el **Caribe colombiano**: sol, horizonte, mar, una frase costeña y a programar en el repo donde estés.

No es un chatbot. Es un loop: tú das la tarea, el modelo pide herramientas, Quillami las ejecuta (con permiso si toca disco) y repite hasta terminar.

TypeScript, MIT, sin frameworks de orquestación. Este repo es el agente y un lugar para armar uno desde cero.

## Qué hace

- **Modo `auto`:** Jev mide la dificultad de cada mensaje y Quillami usa el modelo más barato que la cumple, entre todos los de OpenRouter (según benchmarks de [Artificial Analysis](https://artificialanalysis.ai)) o entre cuatro modelos fijos. `/usage` te muestra cuánto ahorras frente a usar Sonnet siempre
- **OpenRouter** y Anthropic: cientos de modelos con una sola key, con lista y buscador en `/model`
- Lee, busca, lista y edita archivos del workspace; corre `bash` con permiso
- **Diff antes de aprobar:** `write` y `edit` muestran las líneas que salen y las que entran
- **Ctrl+C cancela el turno**, no el proceso: la sesión sigue
- **`bash` con timeout por llamada** (2 min por defecto, hasta 30) y salida en vivo mientras corre
- **Búsqueda con ripgrep** si está instalado (respeta `.gitignore`); si no, búsqueda propia
- **Salidas acotadas:** `read` por páginas, `bash` y MCP recortados por cabeza y cola
- **Prompt caching** en Anthropic y los modelos de OpenRouter que lo soportan
- **`web_fetch`:** descarga URLs públicas (http/https); bloquea redes privadas, localhost, redirecciones a ellas y DNS que apunte adentro
- **MCP:** servidores en `~/.quillami/mcp.json` (stdio o HTTP); tools expuestas como `mcp__servidor__tool`
- **Skills:** carpetas con `SKILL.md`, compatibles con Claude Code, Cursor y `.agents/skills`. El modelo carga la que aplica; tú puedes forzarla con `/nombre`
- **Sesiones:** historial en `~/.quillami/sessions/`; `-c`, `--resume`, `quillami sessions`, `/sessions`, `/new`
- **Modos:** `agent` (normal), `plan` (solo lectura + plan), `yolo` (auto-aprueba; denylist y Jev siguen)
- **One-shot:** `quillami "tu tarea"` — un turno y sale (sin TTY niega tools salvo `--yolo`)
- **`quillami doctor`:** Node, keys (incluida la de benchmarks), ping al proveedor, Jev y MCP
- Memoria de repo: `QUILLAMI.md` / `AGENTS.md` (legacy `KILLAMI.md`)
- Memoria global: `~/.quillami` (`soul.md`, `user.md`, `behaviors.md`)
- Compactación del historial (~20k tokens)
- **Jev (recomendado):** [TypeSafe](https://typesafe.ai) — modo `auto`, auto-aprobación de `bash` inofensivo y memoria al fin del turno. Sin key todo funciona, con un modelo fijo

El workspace es la carpeta desde la que lanzas `quillami`, no necesariamente este repo.

## Requisitos

- Node 22+
- API key de [OpenRouter](https://openrouter.ai/keys) o de [Anthropic](https://console.anthropic.com/) (basta una)
- Recomendado: key de [Jev (TypeSafe)](https://typesafe.ai) para el modo `auto`
- Opcional y gratis: key de [Artificial Analysis](https://artificialanalysis.ai/api-reference) para que `auto` elija según benchmarks
- Opcional: [ripgrep](https://github.com/BurntSushi/ripgrep) (`brew install ripgrep`) para búsquedas más rápidas que respetan `.gitignore`

## Instalar

```bash
npm install -g quillami-code
```

Sin instalar global: `npx quillami-code`. Comandos: **`quillami`** o **`quillami-code`**.

```bash
cd ~/tu-proyecto
quillami
```

### Primera vez

La primera vez que abres Quillami (o cuando no encuentra ninguna key de modelo) te guía. **Lo recomendado son dos keys:** OpenRouter, que te da cientos de modelos con una sola cuenta, y Jev (TypeSafe), que elige automáticamente el mejor modelo para cada tarea (modo `auto`). Con solo OpenRouter también funciona: eliges un modelo fijo y lo cambias cuando quieras con `/model`.

```text
? ¿Cuáles agregas o cambias?
❯ ◼ OpenRouter           falta        recomendada: cientos de modelos con una sola key
  ◼ Jev (TypeSafe)       falta        recomendada: elige el mejor modelo para cada tarea…
  ◻ Anthropic            falta        opcional: Claude directo, sin pasar por OpenRouter
  ◻ Artificial Analysis  falta        opcional, gratis: con OpenRouter y Jev, auto elige…
  ↑↓ moverse · espacio marcar · enter seguir · esc cancelar
```

1. Eliges las keys que quieres: te mueves con las flechas, marcas o desmarcas con la barra espaciadora y sigues con Enter. Las dos recomendadas que te faltan ya vienen marcadas. Hace falta al menos una de modelo (OpenRouter o Anthropic); la de Jev activa `auto`, los permisos inteligentes y la memoria.
2. Pegas cada key; no se ve en pantalla. Anthropic, OpenRouter y Artificial Analysis se verifican antes de guardarse: si el proveedor la rechaza, no se guarda y puedes probar otra.
3. Eliges el modelo con el que arrancas: `auto` (recomendado si pusiste la key de Jev) o uno fijo (ver [Elegir modelo](#elegir-modelo)). Queda por defecto.

Todo se guarda en `~/.quillami/.env` y sirve desde cualquier carpeta. Si ya tenías keys en el `.env` del proyecto (que solo sirven ahí), te ofrece copiarlas.

Para volver a configurar: **`quillami setup`** o **`/setup`** dentro de la sesión. También puedes editar el archivo a mano:

```bash
echo 'OPENROUTER_API_KEY=tu_key' >> ~/.quillami/.env
```

Si vienes de Killami, `~/.killami/.env` sigue cargándose para variables que aún no estén en `~/.quillami`.

Desarrollo en este repo: `npm install`, `npm start`. Tras cambiar código: `npm run build`.

## Uso

Escribes en el prompt. `/exit` o Ctrl+D cierra.

Permisos para acciones sensibles (`write`, `edit`, `bash`, `web_fetch`, `remember_user`, MCP):

```text
? ¿Qué hago?
❯ ◯ Sí, solo esta vez
  ◯ No, no lo toques
  ◯ Sí, y no preguntes más por bash en esta sesión
  ↑↓ moverse · espacio marcar · enter elegir · esc cancelar
```

Eliges con las flechas y Enter, o directo con `s`, `n` o `a`. Esc es no. La tercera opción vale solo para esa herramienta: aprobar `bash` no aprueba `write`. En MCP vale para todo el servidor (`mcp__easybits__*`), no para otros servidores.

Antes de aprobar un `write` o `edit` ves el diff contra el archivo en disco (rojo sale, verde entra, hasta 60 líneas). Si un `edit` va a fallar porque el texto no aparece o aparece varias veces, te avisa ahí mismo. En `bash`, si el modelo pide un tiempo máximo distinto al de por defecto, el prompt lo dice.

`/undo` restaura archivos tocados por `write`/`edit` en el último turno (no deshace `bash`).

### Ctrl+C

| Cuándo | Qué hace |
|--------|----------|
| Durante un turno | Cancela el modelo, el `bash` en curso (con sus procesos hijos), `web_fetch` y MCP. Vuelves al prompt con la sesión intacta |
| Otra vez mientras cancela | Sale de Quillami |
| En el prompt | Limpia la línea; un segundo Ctrl+C en 2 s sale |

El turno cancelado queda en el historial con una nota, porque los archivos que alcanzó a tocar siguen tocados. `/undo` sigue funcionando. En one-shot, cancelar sale con código 130.

### Herramientas

| Tool | Notas |
|------|-------|
| `read` | Hasta 2000 líneas por llamada; `offset` y `limit` para archivos largos (hasta 5 MB). Líneas de más de 2000 caracteres se cortan |
| `write`, `edit` | Con permiso y diff. `edit` reemplaza un texto que debe aparecer una sola vez |
| `bash` | Con permiso. `timeout_seconds` por llamada (default 120, máx. 1800). Mientras corre ves las últimas líneas; al final, `exit 0 · 3.1 s · 10 líneas`. Al modelo le llega la cabeza y la cola de la salida |
| `grep` | `rg` si está en el PATH (respeta `.gitignore`, incluye ocultos, omite `node_modules`, `.git`, `dist`); si no está o el patrón usa algo que solo entiende JavaScript (lookbehind), búsqueda propia. Máx. 50 resultados. `QUILLAMI_RG=off` fuerza la búsqueda propia |
| `glob`, `ls` | Sin permiso |
| `web_fetch` | Con permiso. Valida cada redirección y la IP con la que de verdad conecta. Texto, hasta 20k caracteres |
| `remember_user` | Con permiso. Escribe en `~/.quillami` |
| `skill` | Sin permiso. Carga una [skill](#skills) o uno de sus archivos de apoyo; solo existe si hay skills |

Cualquier resultado de tool se recorta a 30k caracteres antes de llegar al modelo, conservando inicio y final.

Comandos útiles: `/model`, `/models <texto>`, `/setup`, `/mode`, `/login`, `/memory`, `/projects`, `/sessions`, `/new`, `/mcp`, `/skills`, `/usage`, `/undo`, y `/nombre-de-skill`.

```bash
quillami "explica este archivo"     # un turno y sale
quillami -c                         # continúa la última sesión en este repo
quillami --resume <id>              # retoma por id (/sessions)
quillami sessions                   # lista sesiones del cwd
quillami --plan                     # solo lectura + plan al final
quillami --yolo "corre los tests"   # auto-aprueba (denylist/Jev siguen)
quillami doctor                     # keys, ping al proveedor, Jev, MCP
quillami mcp                        # servidores MCP conectados
quillami models qwen coder          # busca modelos en OpenRouter
quillami setup                      # agrega o cambia keys y modelo por defecto
```

## Modos

| Modo | Flag / slash | Comportamiento |
|------|----------------|----------------|
| **agent** | (default) | Tools completas; permisos s/n/a |
| **plan** | `--plan`, `/mode plan` | Solo lectura; el modelo termina con un plan (sin write/bash/MCP) |
| **yolo** | `--yolo`, `/mode yolo` | Auto-aprueba tools; denylist en `bash` y bloqueos Jev siguen |

El prompt es `›`; en plan muestra `plan› ` y en yolo `yolo› `.

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

## Skills

Una skill es una carpeta con un `SKILL.md`: arriba un encabezado con `name` y `description`, abajo las instrucciones, y si quiere archivos de apoyo (`references/`, `scripts/`). Es el mismo formato de Claude Code y Cursor, así que las que ya tengas funcionan sin copiarlas.

```markdown
---
name: deploy
description: Sube el proyecto a producción. Úsala cuando pidan desplegar o publicar.
---
# Pasos
1. Corre los tests…
```

Quillami las busca al arrancar, primero en el proyecto y después en tu home, en este orden:

| carpeta | |
|---------|---|
| `.quillami/skills` | propia |
| `.claude/skills` | Claude Code |
| `.agents/skills` | estándar compartido |
| `.cursor/skills` | Cursor |

Si dos skills se llaman igual, gana la primera: una del proyecto pisa a una global. Los symlinks entre carpetas cuentan una sola vez.

Cómo se usan:

- **Solas.** El modelo ve solo el nombre y la descripción de cada una (unos 80 tokens por skill, cacheados). Cuando tu pedido coincide con una, la carga con la tool `skill` y sigue sus instrucciones. La pantalla muestra `· skill nombre`. Los archivos de apoyo los lee igual, solo si hacen falta.
- **A mano.** `/nombre lo que quieres` (por ejemplo `/animate haz que el modal entre suave`) le pasa la skill completa al modelo junto con tu pedido. También funciona en una sola línea: `quillami "/deploy a staging"`.
- **`/skills`** lista las que encontró y de dónde. El banner dice cuántas hay.

Las skills con `disable-model-invocation: true` no se le muestran al modelo: solo corren con `/nombre`.

Cargar una skill no pide permiso, porque es solo lectura, y la tool no puede leer fuera de la carpeta de la skill. Si una skill le dice al modelo que corra un script, eso pasa por `bash` y te pide permiso como siempre. Una skill del proyecto es texto que el modelo obedece, igual que `AGENTS.md`: revisa las de repos que no conoces.

## Decisiones con Jev

Jev no reemplaza a Claude: no escribe respuestas ni llama tools. El código le hace preguntas tipadas (Score/Noul) y aplica umbrales en TypeScript.

- **Permisos:** `bash` de solo lectura con alta confianza puede auto-aprobarse; comandos muy riesgosos se bloquean; `write`/`edit` siguen pidiendo siempre. Denylist fija (`sudo`, `rm -rf`, `git push`, etc.) nunca auto-aprueba.
- **Modelo `auto`:** Jev puntúa la dificultad de tu mensaje y el código elige el modelo (ver abajo).
- **Memoria:** si el turno no usó `remember_user`, Jev puede proponer una línea para `user.md` o `behaviors.md` (tú confirmas s/n). La línea la redacta el modelo que estés usando, también si es de OpenRouter.

Los permisos y la memoria funcionan igual con cualquier modelo, porque Jev evalúa el comando o tu mensaje, no el modelo.

Key: `/setup` (opción 2), `/login typesafe` o `TYPESAFE_API_KEY` en `~/.quillami/.env`. Apagar: `QUILLAMI_JEV=0`. Uso de Jev en `/usage` (tokens, sin USD).

### Modelo `auto`

En cada mensaje, Jev mide la dificultad de lo que pides (trivial, estándar, difícil o muy difícil) y Quillami elige el modelo. Entre qué modelos elige depende de tus keys:

| Keys | Entre qué modelos elige |
|------|-------------------------|
| Jev + OpenRouter + Artificial Analysis | Todos los modelos de OpenRouter con tools: el más barato que cumple, según benchmarks |
| Jev + OpenRouter | DeepSeek V4.1 Flash (trivial), MiMo V2.6 Pro (estándar), Claude Sonnet 5.5 (difícil) o Claude Opus 5.5 (muy difícil) |
| Jev + Anthropic | Claude Haiku, Sonnet u Opus directo |
| Sin Jev | El modelo estándar en cada mensaje (MiMo V2.6 Pro, o Sonnet 4.5 con Anthropic) |

Con key de Jev y sin modelo guardado, Quillami arranca en `auto`. Antes de cada respuesta ves qué eligió:

```text
· jev · trivial → DeepSeek V4.1 Flash · $0.03 / $0.50 por M
```

#### Con benchmarks

Con `ARTIFICIAL_ANALYSIS_API_KEY` (gratis en [artificialanalysis.ai](https://artificialanalysis.ai/api-reference)), `auto` compara el índice de inteligencia de [Artificial Analysis](https://artificialanalysis.ai) de todos los modelos de OpenRouter con tools y contexto de 128k o más, y usa el más barato que alcanza el mínimo de esa dificultad:

| Dificultad (Jev) | Índice mínimo | Ejemplo hoy |
|------------------|---------------|-------------|
| Trivial | 60 % del mejor modelo | DeepSeek V4.1 Flash ($0.03 / $0.50 por M) |
| Estándar | 80 % | MiMo V2.6 Pro ($0.44 / $0.87) |
| Difícil | 95 % | Claude Sonnet 5.5 ($2 / $10) |
| Muy difícil | 100 % (el mejor) | Claude Opus 5.5 ($4 / $20) |

"Muy difícil" cuesta el doble que "difícil" por poca mejora en el índice, así que solo se activa cuando Jev está bastante seguro: arquitectura de un sistema entero, un bug sutil entre muchos módulos o una migración. Un refactor de varios archivos sigue siendo "difícil".

- El mínimo es relativo al mejor modelo disponible, así que se ajusta solo cuando salen modelos nuevos.
- "Más barato" es el precio mezclado de OpenRouter: 3 partes de entrada por 1 de salida.
- Los benchmarks se guardan en `~/.quillami/artificial-analysis.json` y se refrescan una vez al día (unas 4 de las 100 peticiones diarias del tier gratis). Si la API no responde, usa la última caché; sin caché, los cuatro modelos fijos.
- Los datos son tuyos, con tu key: los términos del tier gratis de Artificial Analysis no permiten redistribuirlos, así que Quillami no trae ninguna copia.
- Para limitar `auto` a ciertos proveedores: `QUILLAMI_AUTO_VENDORS=anthropic,openai,google` en `~/.quillami/.env`. El mínimo se calcula entonces sobre el mejor modelo de esos proveedores.

#### No cambia de modelo sin motivo

Cambiar de modelo pierde la caché del prompt. Si tu mensaje es más difícil que el anterior, siempre cambia: la calidad va primero. Si es igual o más fácil, compara lo que costaría seguir con el modelo actual (leyendo de caché) contra mandar todo el contexto sin caché al nuevo, y se queda con lo más barato:

```text
· jev · trivial → sigue con Claude Opus (su caché sale más barato)
```

Tras 5 minutos sin actividad la caché ya expiró y vuelve a elegir libre.

#### Cuánto ahorras

`/usage` muestra los modelos que usó `auto` en la sesión y lo que habrías gastado con Sonnet en cada mensaje:

```text
  auto     DeepSeek V4.1 Flash ×2 (índice 39.5)
           $0.0005 vs $0.0035 con Claude Sonnet siempre (ahorro 86%)
           benchmarks: Artificial Analysis (artificialanalysis.ai)
```

#### ¿Y Jev Router?

OpenRouter tiene [Jev Router](https://openrouter.ai/typesafe/jev-router) (`/model typesafe/jev-router`), que elige entre todo el catálogo. Se puede usar como modelo fijo, pero no acepta criterios: ve el system prompt y las tools de Quillami, no solo tu mensaje, y en una prueba mandó "Di solo: hola" a `openai/gpt-6-astra` ($10 / $50 por millón). Por eso `auto` usa Jev local.

## Modelos

### Elegir modelo

Escribe **`/model`** y sale una lista:

```text
? ¿Qué modelo usas?
  buscar: ▏
  Recomendado
❯ ◯ auto  Auto (Jev)  OpenRouter  ← actual

  OpenRouter · siempre la versión más nueva de cada familia (precio USD por M de tokens)
  ◯ ~anthropic/claude-fable-latest      $10.00 / $50.00 por M · 1000k ctx
  ◯ ~deepseek/deepseek-flash-latest     $0.025 / $0.60 por M · 1049k ctx
  ◯ ~openai/gpt-sol-latest              $2.00 / $10.00 por M · 1050k ctx
  ↑↓ moverse · espacio marcar · enter elegir · escribe para buscar · esc salir
```

Con key de Anthropic aparece además la sección **Directos** (Sonnet, Opus, Fable, Haiku sin pasar por OpenRouter); sin ella no se muestra, porque Claude ya está en la lista de OpenRouter.

- **Flechas y Enter** eligen de la lista. El cursor arranca en el modelo actual.
- **Escribir** (por ejemplo `qwen coder`, `kimi`, `gemini flash`) filtra en vivo todo el catálogo de OpenRouter, del más nuevo al más viejo. Borrar el texto vuelve a la lista inicial.
- **Esc** sale sin cambiar nada.
- **`/model <alias o id>`** (`/model haiku`, `/model qwen/qwen3-coder`) lo usa directo, sin lista.
- **`/models <texto>`** abre la lista ya filtrada.

Si la salida no es una terminal (por ejemplo en un script), en vez de la lista sale la versión de antes: números, alias o texto para buscar.

Los destacados de OpenRouter son sus alias `~…-latest`, que siempre apuntan al modelo más nuevo de cada familia, así que la lista no se queda vieja. Si eliges un modelo sin key, te la pide en ese momento. Al final te pregunta si lo dejas por defecto (`QUILLAMI_MODEL` en `~/.quillami/.env`).

Desde la línea de comandos:

```bash
quillami --model haiku
quillami -m qwen/qwen3-coder        # cualquier id de OpenRouter
```

| alias | modelo | proveedor |
|-------|--------|-----------|
| `auto` | El más barato que cumple, en cada mensaje (ver [Modelo `auto`](#modelo-auto)) | OpenRouter o Anthropic (+ Jev) |
| `sonnet` | Sonnet 5 | Anthropic |
| `sonnet-4.5` | Sonnet 4.5 | Anthropic (default con Claude) |
| `opus` | Opus 5 | Anthropic |
| `fable` | Fable 5.1 | Anthropic |
| `haiku` | Haiku 4.5 | Anthropic |
| `openrouter` | Sonnet 5 (`anthropic/claude-sonnet-5`) | OpenRouter |
| `vendor/modelo` | cualquier modelo del catálogo | OpenRouter |

Prioridad del default: `--model` → `QUILLAMI_MODEL` → `KILLAMI_MODEL` (legacy) → `ANTHROPIC_MODEL` → `auto` si hay key de Jev → Sonnet 4.5 (o Sonnet 5 vía OpenRouter si no hay `ANTHROPIC_API_KEY`).

### OpenRouter

Una sola key ([openrouter.ai/keys](https://openrouter.ai/keys)) da acceso a cientos de modelos: Claude, GPT, Gemini, Qwen, DeepSeek, Kimi, GLM, etc. Quillami usa el endpoint compatible con Anthropic de OpenRouter, así que tools, streaming y caché funcionan igual.

- **Key:** márcala en `quillami setup` (o la primera vez), `/login openrouter`, o `OPENROUTER_API_KEY` en `~/.quillami/.env`
- **Elegir modelo:** `/model` (lista y buscador) o cualquier id con barra, p. ej. `/model qwen/qwen3-coder-next` o `quillami -m qwen/qwen3-coder`. Los ids con `~` (como `~openai/gpt-sol-latest`) apuntan siempre a la versión más nueva
- **Buscar sin abrir sesión:** `quillami models` muestra los destacados; `quillami models qwen coder` busca. Precio por millón de tokens y contexto. Solo lista modelos que aceptan tools
- **Validación:** antes de usar un id, Quillami lo busca en el catálogo. Si no existe, sugiere parecidos y no gasta una llamada; si existe pero no soporta tools, avisa
- **Precios:** el catálogo público se guarda en `~/.quillami/openrouter-models.json` (se refresca cada 24 h; sin red usa la copia vieja). Sirve para mostrar precios en la lista; los routers aparecen como "precio variable"
- **Endpoint propio:** `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api`)

- **Gasto real:** OpenRouter informa en cada respuesta lo que cobró, y Quillami usa ese valor en vez de estimarlo con el catálogo
- **Modelo servido:** si OpenRouter responde con un modelo distinto al pedido (un alias `~…-latest`, `auto` vía OpenRouter o Jev Router), lo verás: `· openrouter · ~deepseek/deepseek-pro-latest → deepseek/…`

Cada proveedor recibe solo su propia key: tu `ANTHROPIC_API_KEY` nunca viaja a OpenRouter.

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

Cada turno muestra tokens y estimado en USD. `/usage` detalla el turno, la sesión y el total acumulado (`~/.quillami/usage.json`); con `auto`, también qué modelos usó y cuánto ahorraste frente a Sonnet.

Quillami marca puntos de caché en las tools, el system prompt y el último mensaje, así que en una conversación larga la mayor parte del prompt sale de caché. La línea de tokens lo muestra: `10k in (90% de caché)`. El costo cuenta la escritura de caché a 1.25× y la lectura a 0.1× del precio de input. En OpenRouter no se estima: se usa lo que OpenRouter dice que cobró.

## Arquitectura (breve)

```text
src/index.ts         CLI, REPL, one-shot
src/cli.ts           flags y subcomandos
src/interrupt.ts     Ctrl+C: cancela el turno, no el proceso
src/agent/loop.ts    loop modelo → tools
src/agent/cache.ts   puntos de prompt caching
src/agent/compact.ts compactación del historial
src/toolRegistry.ts  builtin + MCP por modo
src/tools.ts         read write edit bash grep glob ls web_fetch remember_user
src/ripgrep.ts       grep con rg
src/liveOutput.ts    salida de bash en vivo
src/truncate.ts      recorte cabeza/cola de salidas
src/webFetch.ts      web_fetch con validación de redirecciones y DNS
src/mcp.ts           cliente MCP (@modelcontextprotocol/sdk)
src/sessions.ts      persistencia ~/.quillami/sessions
src/permissions.ts   s/n/a por tool, plan, yolo, Jev
src/diff.ts          diff de write/edit antes de aprobar
src/jev.ts           cliente TypeSafe
src/decisions.ts     riesgo, modo auto (dificultad, caché), memoria
src/benchmarks.ts    Artificial Analysis: datos, emparejado con OpenRouter, elección por preciosrc/usage.ts         tokens, gasto y ahorro de auto
src/doctor.ts        quillami doctor
src/providers.ts     cliente por proveedor (Anthropic, OpenRouter)
src/openrouter.ts    catálogo, búsqueda y precios de OpenRouter
src/modelPicker.ts   lista numerada y buscador de /model
src/onboarding.ts    primera vez y quillami setup: keys verificadas
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

- Sandbox real (p. ej. Firecracker), no solo consentimiento
- Subagentes
- Reintentos ante 429
- Más evals con pass rate por modelo
- Búsqueda web (hoy solo `web_fetch` de una URL)

Issues y PRs bienvenidos.

## Licencia

[MIT](LICENSE) © Anuar Harb
