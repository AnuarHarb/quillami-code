# Quillami Code

Un agente de código que corre en tu terminal. Nace en el **Caribe colombiano**: se abre con sol, palma y mar, te suelta una frase costeña y se pone a programar en el repo donde estés.

No es un chatbot. Es un loop. Tú le das una tarea, el modelo pide herramientas, Quillami las ejecuta (con tu permiso cuando toca el disco) y le devuelve el resultado hasta que termina.

Este repo es el agente y, a la vez, un lugar para **armar un agente de código desde aquí**: loop, tools, permisos, memoria, compactación, modelos. Sin frameworks de orquestación. TypeScript, claro, y MIT.

## Qué hace

- Lee, busca y lista archivos del workspace
- Edita y escribe código
- Corre comandos en la carpeta actual
- Pregunta antes de `write`, `edit` o `bash`
- Recuerda el proyecto si existe un `QUILLAMI.md` o un `AGENTS.md` (también lee `KILLAMI.md` legacy)
- Compacta el historial cuando la sesión se pone pesada
- Cambia de modelo al vuelo (`sonnet`, `opus`, `fable`, `haiku`, `minimax`)

El workspace es el directorio desde el que lanzas `quillami`, no la carpeta de este repo.

## Requisitos

- Node 22 o más
- Una API key de [Anthropic](https://console.anthropic.com/) **o** de [MiniMax](https://platform.minimax.io/)

## Instalar

```bash
npm install -g quillami-code
```

O sin instalarlo: `npx quillami-code`. El comando es `quillami` (también vale `quillami-code`).

Necesitas Node 22+ y una API key de Anthropic o MiniMax. La primera vez que falte, **Quillami te la pide en la terminal** (no se ve en pantalla) y la guarda en `~/.quillami/.env`. También puedes pegarla a mano ahí o en el `.env` del proyecto:

```bash
mkdir -p ~/.quillami
echo 'ANTHROPIC_API_KEY=tu_key' >> ~/.quillami/.env
# o
echo 'MINIMAX_API_KEY=tu_key' >> ~/.quillami/.env
```

Si vienes de Killami, `~/.killami/.env` sigue cargándose para variables que falten en `~/.quillami`.

Luego, en el repo donde vas a trabajar:

```bash
cd ~/tu-proyecto
quillami
```

Para desarrollar este repo: `npm install` y `npm start`. Si cambias el código, `npm run build` actualiza el bin.

## Uso

Escribes en el prompt. `/exit` cierra.

```text
> arregla el test que está fallando en src/auth.ts
```

Mientras piensa ves un spinner (*Un momentico…*). El texto sale en streaming. Si va a escribir o a correr un comando:

```text
· edit src/auth.ts
  src/auth.ts · cambia un bloque
  s  sí, solo esta vez
  n  no, no lo toques
  a  sí, y no preguntes más en esta sesión
  ¿Qué hago?
```

`read`, `ls`, `grep` y `glob` no preguntan. Solo miran.

Si el turno quedó mal:

```text
> /undo
   undo: restauré src/auth.ts
```

Eso restaura los archivos que `write` y `edit` tocaron en el último prompt. El chat no se borra. `bash` no entra en el checkpoint: un `rm` no se deshace así. `/undo` otra vez vuelve al turno anterior (hasta 50).

## Modelos

Anthropic (Claude) y MiniMax. Default: Sonnet 4.5 (o MiniMax M3 si solo tienes `MINIMAX_API_KEY`).

```bash
quillami --model haiku
quillami -m minimax
```

O en la sesión:

```text
/model
/model sonnet
/model minimax
/login minimax
```

`/login` (o `/login anthropic`) rota la API key del proveedor: te la pide oculta y actualiza `~/.quillami/.env`.

| alias | modelo | proveedor | para qué |
|---|---|---|---|
| `sonnet` | Sonnet 5 | Anthropic | programar, el equilibrio |
| `sonnet-4.5` | Sonnet 4.5 | Anthropic | el default con Claude |
| `opus` | Opus 5 | Anthropic | más capaz, más caro |
| `fable` | Fable 5.1 | Anthropic | razonar largo |
| `haiku` | Haiku 4.5 | Anthropic | rápido y barato |
| `minimax` | MiniMax M3 | MiniMax | agente, tools, contexto largo |

También puedes poner `QUILLAMI_MODEL=minimax` en el `.env` (o `KILLAMI_MODEL` legacy). Prioridad: `--model` → `QUILLAMI_MODEL` → `KILLAMI_MODEL` → `ANTHROPIC_MODEL` → Sonnet 4.5 (o MiniMax si solo hay key de MiniMax).

MiniMax usa el endpoint compatible con Anthropic (`MINIMAX_BASE_URL` opcional; en China: `https://api.minimaxi.com/anthropic`).

## Memoria global (`~/.quillami`)

Tres archivos que Quillami puede ir escribiendo (con tu permiso, tool `remember_user`):

| Archivo | Para qué |
|---------|----------|
| `soul.md` | Identidad de Quillami (voz, intereses, qué ha hecho como agente) |
| `user.md` | Lo que va aprendiendo sobre **ti** (rol, metas, preferencias) |
| `behaviors.md` | Cómo debe interactuar contigo (reglas de conducta) |

El CLI registra en `projects.json` cada carpeta donde abres `quillami` (para ver en qué proyectos has estado).

```text
/memory      preview de soul, user, behaviors
/projects    lista de workspaces visitados
/soul /user /behaviors   ver el archivo completo (truncado si es enorme)
```

La primera vez crea plantillas mínimas. No guarda API keys ni secretos.

## Memoria del proyecto

En la raíz del repo que estés editando, crea un `QUILLAMI.md` (o un `AGENTS.md`). Quillami lo lee cada vez que piensa: cómo está armado el código, qué no tocar, convenciones.

Si le pides que se acuerde de algo **del repo**, lo anota ahí (permiso `write`). Cosas **sobre ti** o sobre **cómo actuar** → `remember_user` y los `.md` globales. El historial de la charla es otra cosa: si pasa de ~20k tokens, se compacta solo.

## Tokens y gasto

Después de cada turno ves cuántos tokens entraron y salieron, lo de la sesión y un estimado en dólares (precios de lista de Anthropic). `/usage` muestra el desglose. El total se guarda en `~/.quillami/usage.json`.

## Cómo está armado

```text
src/index.ts            CLI, banner, /model, /undo, /usage
src/config.ts           Quillami, ~/.quillami, QUILLAMI.md
src/agent/loop.ts       modelo → tools → resultado → repeat
src/agent/compact.ts    resume lo viejo (~20k tokens)
src/usage.ts            tokens y estimado en dólares
src/checkpoint.ts       fotos de write/edit por turno
src/tools.ts            read write edit bash grep glob ls remember_user
src/permissions.ts      s / n / a
src/memory.ts           QUILLAMI.md y AGENTS.md
src/userMemory.ts       soul.md, user.md, behaviors.md, projects.json
src/models.ts           catálogo y alias
src/banner.ts           el dibujo de la costa
src/spinner.ts          “está pensando”
test/                   tests del harness
evals/                  tareas reales contra el modelo
```

El núcleo cabe en el loop. Lo demás es el harness: que no se escape del workspace, que pregunte antes de romper algo, que no se ahogue de tokens.

## Tests y evals

Los tests prueban el harness. No gastan API key.

```bash
npm test
```

Los evals sí llaman al modelo: un repo temporal, una tarea, ¿el archivo quedó como se pedía?

```bash
npm run eval
```

Hay cuatro: cambiar un greeting, crear `sum`, arreglar `double`, y respetar un `QUILLAMI.md` que bloquea un archivo. Usan `QUILLAMI_EVAL_MODEL` (default: haiku).

## CI

En cada push y pull request, GitHub Actions corre typecheck, tests y build.

Si el repo tiene el secret `ANTHROPIC_API_KEY`, el job de evals también corre. Sin el secret, ese job se omite (sale “Evals omitidos”) y el CI no se pone rojo.

## Licencia

[MIT](LICENSE) © Anuar Harb
