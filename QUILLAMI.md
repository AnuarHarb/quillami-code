# Quillami Code

Agente de código en TypeScript. Los usuarios lo instalan con `npm install -g quillami-code`. El comando es `quillami` (o `quillami-code`). Aquí también vale `npm start`.

- Entrada: `src/index.ts`
- Config: `src/config.ts` — nombre, `~/.quillami`, `QUILLAMI.md`
- Loop: `src/agent/loop.ts`
- Compactación: `src/agent/compact.ts` — si el historial pasa ~20k tokens, resume lo viejo y deja ~7k de cola
- Tokens: `src/usage.ts` — gasto por turno/sesión/total; `/usage`
- Modelos: `src/models.ts` — Anthropic + MiniMax; `quillami --model minimax` o `/model`
- Proveedores: `src/providers.ts` — cliente Anthropic SDK con baseURL de MiniMax
- Keys: `src/auth.ts` — prompt oculto, guarda en `~/.quillami/.env`; `/login`
- Memoria global: `src/userMemory.ts` — `~/.quillami/soul.md`, `user.md`, `behaviors.md`, `projects.json`; `/memory`, `/projects`
- Tools: `src/tools.ts` (`read`, `write`, `edit`, `bash`, `grep`, `glob`, `ls`, `remember_user`)
- Permisos: `src/permissions.ts` — `write`, `edit`, `bash` y `remember_user` preguntan s/n/a
- Checkpoints: `src/checkpoint.ts` — foto de `write`/`edit` por turno; `/undo` restaura. `bash` no se deshace.
- Banner: `src/banner.ts`
- Spinner: `src/spinner.ts`

Los tests del harness: `npm test`. Los evals del agente: `npm run eval` (necesitan API key). CI en `.github/workflows/ci.yml`. Después de cambiar el código, corre `npm run build` para que el comando `quillami` se actualice.

No commitear `.env`. La API key puede vivir en `.env` del proyecto o en `~/.quillami/.env`. Sigue leyendo `~/.killami/.env` si migras desde Killami.
