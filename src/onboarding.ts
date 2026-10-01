import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { saveUserKey } from "./auth.js";
import { AA_URL } from "./benchmarks.js";
import { dim } from "./banner.js";
import { configDir, displayPath } from "./config.js";
import { envFileKeys, projectEnvPath, userEnvPath } from "./env.js";
import { OPENROUTER_BASE_URL } from "./openrouter.js";
import { anyProviderKey } from "./providers.js";

export type KeySlotId = "anthropic" | "openrouter" | "typesafe" | "artificialanalysis";

export type KeySlot = {
  id: KeySlotId;
  envVar: string;
  label: string;
  url: string;
  hint: string;
  /** Model providers; Jev alone cannot run a turn. */
  model: boolean;
};

export const KEY_SLOTS: KeySlot[] = [
  {
    id: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    url: "https://openrouter.ai/keys",
    hint: "recomendada: cientos de modelos con una sola key",
    model: true,
  },
  {
    id: "typesafe",
    envVar: "TYPESAFE_API_KEY",
    label: "Jev (TypeSafe)",
    url: "https://typesafe.ai",
    hint: "recomendada: elige el mejor modelo para cada tarea y aprueba solo comandos inofensivos",
    model: false,
  },
  {
    id: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    url: "https://console.anthropic.com/settings/keys",
    hint: "opcional: Claude directo, sin pasar por OpenRouter",
    model: true,
  },
  {
    id: "artificialanalysis",
    envVar: "ARTIFICIAL_ANALYSIS_API_KEY",
    label: "Artificial Analysis",
    url: "https://artificialanalysis.ai/api-reference",
    hint: "opcional, gratis: con OpenRouter y Jev, auto elige según benchmarks",
    model: false,
  },
];

const RECOMMENDED = "1 2";

const INTRO = [
  "",
  "Bienvenido a Quillami Code.",
  "",
  "Recomendado: OpenRouter + Jev. Con OpenRouter tienes cientos de modelos con una sola key;",
  "con Jev, el modo auto elige el mejor para cada tarea. Solo OpenRouter también sirve (modelo fijo).",
];

export type KeyCheck = "ok" | "invalid" | "unknown" | "skipped";

export type OnboardingIO = {
  ask: (prompt: string) => Promise<string>;
  /** Hidden input; null when cancelled. */
  secret: (prompt: string) => Promise<string | null>;
  print: (text: string) => void;
};

export type OnboardingDeps = {
  verify?: (slot: KeySlot, key: string) => Promise<KeyCheck>;
  save?: (envVar: string, value: string) => void;
  userEnvFile?: string;
  projectEnvFile?: string;
};

const MAX_SELECTION_TRIES = 3;
const MAX_KEY_TRIES = 3;
const VERIFY_TIMEOUT_MS = 8000;

export function onboardingMarkerPath(): string {
  return path.join(configDir(), "onboarding.json");
}

export function onboardingDone(): boolean {
  return existsSync(onboardingMarkerPath());
}

export function markOnboardingDone(): void {
  const file = onboardingMarkerPath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ completedAt: new Date().toISOString() })}\n`, "utf8");
}

/**
 * Shows which keys exist, lets the user add or replace any of them, verifies
 * each against its provider and saves it to ~/.quillami/.env.
 */
export async function runOnboarding(
  io: OnboardingIO,
  deps: OnboardingDeps = {},
): Promise<{ added: KeySlotId[]; hasModelKey: boolean }> {
  const verify = deps.verify ?? verifyKey;
  const save = deps.save ?? ((envVar: string, value: string) => saveUserKey(envVar, value));
  const userFile = deps.userEnvFile ?? userEnvPath();
  const projectFile = deps.projectEnvFile ?? projectEnvPath();

  io.print(INTRO.join("\n"));
  io.print(dim(`Se guardan en ${displayPath(userFile)} y cada una solo viaja a su proveedor.\n`));

  await offerProjectKeyCopy(io, save, userFile, projectFile);

  const added: KeySlotId[] = [];
  io.print(renderKeyStatus(userFile, projectFile));

  let selection: KeySlot[] = [];
  for (let attempt = 0; attempt < MAX_SELECTION_TRIES; attempt += 1) {
    const answer = await io.ask(
      `¿Cuáles agregas o cambias? Números separados por espacio (recomendado: ${RECOMMENDED}), Enter para seguir: `,
    );
    const parsed = parseSelection(answer);
    if (parsed === null) {
      io.print(dim(`   usa números del 1 al ${KEY_SLOTS.length}.`));
      continue;
    }
    if (parsed.length === 0 && !anyProviderKey()) {
      io.print(
        dim("   necesitas al menos una key de modelo para empezar; la recomendada es 1 (OpenRouter)."),
      );
      continue;
    }
    selection = parsed;
    break;
  }

  for (const slot of selection) {
    if (await addKey(io, slot, verify, save)) added.push(slot.id);
  }

  return { added, hasModelKey: anyProviderKey() };
}

async function addKey(
  io: OnboardingIO,
  slot: KeySlot,
  verify: (slot: KeySlot, key: string) => Promise<KeyCheck>,
  save: (envVar: string, value: string) => void,
): Promise<boolean> {
  io.print(`\n${slot.label} · ${slot.url}`);
  io.print(dim("   Pégala aquí. No se ve en pantalla."));
  for (let attempt = 0; attempt < MAX_KEY_TRIES; attempt += 1) {
    const value = (await io.secret(`${slot.label}: `))?.trim();
    if (!value) {
      io.print(dim("   la salto."));
      return false;
    }
    const check = await verify(slot, value);
    if (check === "invalid") {
      io.print(dim(`   ✗ ${slot.label} rechazó esa key.`));
      const retry = await io.ask("¿Pruebas con otra? (s/N): ");
      if (!/^s/i.test(retry.trim())) return false;
      continue;
    }
    save(slot.envVar, value);
    process.env[slot.envVar] = value;
    if (check === "ok") io.print(dim("   ✓ funciona, guardada."));
    else if (check === "unknown") io.print(dim("   no pude verificarla (¿sin red?); la guardé igual."));
    else io.print(dim("   guardada."));
    return true;
  }
  return false;
}

/** Keys that only live in ./.env work in this folder alone; offer to make them global. */
async function offerProjectKeyCopy(
  io: OnboardingIO,
  save: (envVar: string, value: string) => void,
  userFile: string,
  projectFile: string,
): Promise<void> {
  if (path.resolve(userFile) === path.resolve(projectFile)) return;
  const inProject = envFileKeys(projectFile);
  const inUser = envFileKeys(userFile);
  const projectOnly = KEY_SLOTS.filter(
    (slot) => inProject.has(slot.envVar) && !inUser.has(slot.envVar) && process.env[slot.envVar]?.trim(),
  );
  if (projectOnly.length === 0) return;

  io.print(
    `Estas keys están en ${displayPath(projectFile)} y solo sirven en esta carpeta: ${projectOnly.map((slot) => slot.label).join(", ")}.`,
  );
  const answer = await io.ask(`¿Las copio a ${displayPath(userFile)} para usarlas en cualquier proyecto? (s/N): `);
  if (!/^s/i.test(answer.trim())) {
    io.print("");
    return;
  }
  for (const slot of projectOnly) {
    save(slot.envVar, process.env[slot.envVar]!.trim());
  }
  io.print(dim("   copiadas.\n"));
}

export function renderKeyStatus(userFile: string, projectFile: string): string {
  const inUser = envFileKeys(userFile);
  const inProject = envFileKeys(projectFile);
  const width = Math.max(...KEY_SLOTS.map((slot) => slot.label.length));
  const lines = KEY_SLOTS.map((slot, index) => {
    const set = Boolean(process.env[slot.envVar]?.trim());
    const status = !set
      ? "falta"
      : inUser.has(slot.envVar) || !inProject.has(slot.envVar)
        ? "✓ lista"
        : "✓ solo aquí";
    return `  ${index + 1}  ${slot.label.padEnd(width)}  ${status.padEnd(11)}  ${dim(slot.hint)}`;
  });
  return `${lines.join("\n")}\n`;
}

/** null when the answer has something other than valid slot numbers. */
export function parseSelection(answer: string): KeySlot[] | null {
  const tokens = answer.split(/[\s,]+/).filter(Boolean);
  const picked: KeySlot[] = [];
  for (const token of tokens) {
    const index = /^\d+$/.test(token) ? Number(token) - 1 : -1;
    const slot = KEY_SLOTS[index];
    if (!slot) return null;
    if (!picked.includes(slot)) picked.push(slot);
  }
  return picked;
}

/** A cheap authenticated GET per provider; 401/403 means the key is wrong. */
export async function verifyKey(
  slot: KeySlot,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> {
  let url: string;
  let headers: Record<string, string>;
  if (slot.id === "anthropic") {
    const base = process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com";
    url = `${base.replace(/\/+$/, "")}/v1/models?limit=1`;
    headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
  } else if (slot.id === "openrouter") {
    const base = process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL;
    url = `${base.replace(/\/+$/, "")}/v1/key`;
    headers = { Authorization: `Bearer ${key}` };
  } else if (slot.id === "artificialanalysis") {
    url = `${AA_URL}?page=1`;
    headers = { "x-api-key": key };
  } else {
    return "skipped";
  }

  try {
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (response.ok) return "ok";
    if (response.status === 401 || response.status === 403) return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  }
}
