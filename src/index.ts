#!/usr/bin/env node
import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dim, printBanner } from "./banner.js";
import { CONFIG_DIR_NAME, PROJECT_MEMORY_FILE } from "./config.js";
import { runTurn, type History } from "./agent/loop.js";
import { hasKey, promptAndSaveKey } from "./auth.js";
import { createCheckpointStore, type UndoResult } from "./checkpoint.js";
import { loadEnv } from "./env.js";
import { listMemoryFiles } from "./memory.js";
import {
  DEFAULT_MODEL_ID,
  defaultModel,
  formatModelLine,
  formatModelList,
  MINIMAX_M3_ID,
  resolveModel,
  type ModelChoice,
} from "./models.js";
import { createGate } from "./permissions.js";
import { keyEnvFor, type Provider } from "./providers.js";
import { createUsageLedger } from "./usage.js";
import {
  ensureTemplates,
  formatMemorySummary,
  formatProjectsList,
  readGlobalFile,
  touchProjectRegistry,
  type MemoryTarget,
} from "./userMemory.js";

function parseArgs(argv: string[]): { model?: string } {
  const args: { model?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--model" || token === "-m") {
      args.model = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function anyProviderKey(): boolean {
  return hasKey("anthropic") || hasKey("minimax");
}

async function pickInitialProvider(): Promise<Provider | null> {
  console.log("\n¿Con cuál proveedor quieres empezar?\n");
  console.log("  1  Anthropic (Claude)");
  console.log("  2  MiniMax\n");

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const raw = (await rl.question("Elige 1 o 2: ")).trim();
      if (raw === "1") return "anthropic";
      if (raw === "2") return "minimax";
    }
    return null;
  } finally {
    rl.close();
  }
}

function modelForProvider(provider: Provider): ModelChoice {
  if (provider === "minimax") {
    return resolveModel(MINIMAX_M3_ID)!;
  }
  return resolveModel(DEFAULT_MODEL_ID)!;
}

async function ensureKeyForModel(
  model: ModelChoice,
  rl?: Interface,
): Promise<boolean> {
  if (hasKey(model.provider)) return true;
  if (rl) rl.pause();
  const ok = await promptAndSaveKey(model.provider);
  if (rl) rl.resume();
  return ok;
}

async function handleSlash(
  input: string,
  current: ModelChoice,
  rl: Interface,
): Promise<{ model: ModelChoice; handled: boolean }> {
  const [command, ...rest] = input.split(/\s+/);
  const arg = rest.join(" ").trim();

  if (command === "/login") {
    const provider = resolveLoginProvider(arg) ?? current.provider;
    rl.pause();
    await promptAndSaveKey(provider);
    rl.resume();
    return { model: current, handled: true };
  }

  if (command === "/memory") {
    console.log(`\n${formatMemorySummary()}\n`);
    return { model: current, handled: true };
  }

  if (command === "/projects") {
    console.log(`\n${formatProjectsList()}`);
    return { model: current, handled: true };
  }

  if (command === "/soul" || command === "/user" || command === "/behaviors") {
    const target = command.slice(1) as MemoryTarget;
    console.log(`\n${readGlobalFile(target)}\n`);
    return { model: current, handled: true };
  }

  if (command !== "/model" && command !== "/models") {
    return { model: current, handled: false };
  }

  if (!arg) {
    console.log(`\n${formatModelList(current.id)}\n`);
    console.log(dim(`   actual: ${formatModelLine(current)}`));
    console.log(dim("   ejemplo: /model haiku · /login minimax\n"));
    return { model: current, handled: true };
  }

  const next = resolveModel(arg);
  if (!next) {
    console.log(dim(`   no conozco "${arg}". Prueba /model para ver la lista.\n`));
    return { model: current, handled: true };
  }

  const ready = await ensureKeyForModel(next, rl);
  if (!ready) {
    console.log(dim(`   sin key de ${keyEnvFor(next.provider)}, sigo con ${current.alias}.\n`));
    return { model: current, handled: true };
  }

  console.log(dim(`   modelo: ${formatModelLine(next)}\n`));
  return { model: next, handled: true };
}

function resolveLoginProvider(raw: string): Provider | null {
  const needle = raw.trim().toLowerCase();
  if (!needle || needle === "anthropic" || needle === "claude") return "anthropic";
  if (needle === "minimax") return "minimax";
  return null;
}

async function main(): Promise<void> {
  loadEnv();

  const args = parseArgs(process.argv.slice(2));
  let model = defaultModel();
  if (args.model) {
    const chosen = resolveModel(args.model);
    if (!chosen) {
      console.error(`No conozco el modelo "${args.model}".`);
      console.error(formatModelList(""));
      process.exit(1);
    }
    model = chosen;
  }

  printBanner();

  if (!anyProviderKey() && !args.model) {
    const picked = await pickInitialProvider();
    if (!picked) {
      console.error("No elegiste proveedor. Salgo.");
      process.exit(1);
    }
    model = modelForProvider(picked);
  }

  if (!(await ensureKeyForModel(model))) {
    console.error(`Necesitas ${keyEnvFor(model.provider)} para usar ${model.label}.`);
    process.exit(1);
  }

  ensureTemplates();
  touchProjectRegistry(process.cwd());

  console.log(dim(`   workspace: ${process.cwd()}`));
  const memoryFiles = listMemoryFiles();
  console.log(
    dim(
      memoryFiles.length > 0
        ? `   memoria: ${memoryFiles.join(", ")}`
        : `   memoria: ninguna (puedes crear ${PROJECT_MEMORY_FILE})`,
    ),
  );
  console.log(dim(`   modelo: ${formatModelLine(model)}`));
  console.log(dim(`   memoria global: soul, user, behaviors (~/${CONFIG_DIR_NAME})`));
  console.log(dim("   write, edit, bash y remember_user piden permiso (s / n / a)."));
  console.log(dim("   /memory /projects /soul /user /behaviors · /model · /login"));
  console.log(dim("   /undo restaura el último turno. /usage tokens y gasto. /exit sale.\n"));

  const rl = createInterface({ input: stdin, output: stdout });
  const history: History = [];
  const checkpoints = createCheckpointStore();
  const usage = createUsageLedger();
  const gate = createGate(async (prompt) => {
    try {
      return await rl.question(prompt);
    } catch {
      return "n";
    }
  });

  try {
    while (true) {
      let input: string;
      try {
        if (stdin.readableEnded) break;
        input = (await rl.question("> ")).trim();
      } catch {
        break;
      }
      if (!input) continue;
      if (input === "/exit" || input === "/quit") break;
      if (input === "/undo") {
        printUndo(await checkpoints.undo());
        continue;
      }
      if (input === "/usage" || input === "/tokens") {
        console.log(`\n${usage.report()}\n`);
        continue;
      }

      const slash = await handleSlash(input, model, rl);
      model = slash.model;
      if (slash.handled) continue;

      try {
        await runTurn(input, history, gate, model, checkpoints, usage);
        console.log(dim(usage.turnLine()));
        console.log("");
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
    }
  } finally {
    rl.close();
  }
}

function printUndo(result: UndoResult | null): void {
  if (!result) {
    console.log(dim("   no hay checkpoint para deshacer.\n"));
    return;
  }

  const parts = [
    ...result.restored.map((file) => `restauré ${file}`),
    ...result.deleted.map((file) => `borré ${file}`),
  ];
  if (parts.length === 0) {
    console.log(dim("   el último turno no había tocado archivos.\n"));
    return;
  }
  console.log(dim(`   undo: ${parts.join(", ")}\n`));
}

await main();
