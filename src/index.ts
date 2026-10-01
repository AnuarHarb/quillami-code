#!/usr/bin/env node
import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dim, printBanner } from "./banner.js";
import { CONFIG_DIR_NAME, PROJECT_MEMORY_FILE } from "./config.js";
import { maybeProposeAutoMemory } from "./autoMemory.js";
import { runTurn, type History } from "./agent/loop.js";
import { parseArgs } from "./cli.js";
import { assessMessageComplexity } from "./decisions.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import { hasKey, promptAndSaveKey, promptAndSaveNamedKey } from "./auth.js";
import { formatJevModelPick, jevBannerLine, jevEnabled } from "./jev.js";
import { createCheckpointStore, type UndoResult } from "./checkpoint.js";
import { loadEnv } from "./env.js";
import { listMemoryFiles } from "./memory.js";
import { connectMcpServers, type McpRuntime } from "./mcp.js";
import {
  DEFAULT_MODEL_ID,
  defaultModel,
  formatModelLine,
  formatModelList,
  isAutoModel,
  MINIMAX_M3_ID,
  resolveModel,
  type ModelChoice,
} from "./models.js";
import { formatModeLabel, promptPrefix, type AgentMode } from "./mode.js";
import { createAssessRisk, createGate } from "./permissions.js";
import { keyEnvFor, type Provider } from "./providers.js";
import {
  createSessionId,
  formatSessionsList,
  latestSessionForCwd,
  loadSession,
  saveSession,
  titleFromMessage,
  type SessionFile,
} from "./sessions.js";
import { createToolRegistry, type ToolRegistry } from "./toolRegistry.js";
import { createUsageLedger } from "./usage.js";
import {
  ensureTemplates,
  formatMemorySummary,
  formatProjectsList,
  readGlobalFile,
  touchProjectRegistry,
  type MemoryTarget,
} from "./userMemory.js";

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

type SlashContext = {
  model: ModelChoice;
  mode: AgentMode;
  sessionId: string | null;
  history: History;
  mcp: McpRuntime;
};

async function handleSlash(
  input: string,
  ctx: SlashContext,
  rl: Interface,
): Promise<{ model: ModelChoice; mode: AgentMode; sessionId: string | null; handled: boolean }> {
  const [command, ...rest] = input.split(/\s+/);
  const arg = rest.join(" ").trim();
  let { model, mode, sessionId } = ctx;

  if (command === "/login") {
    rl.pause();
    if (resolveTypesafeLogin(arg)) {
      await promptAndSaveNamedKey(
        "TYPESAFE_API_KEY",
        "TypeSafe (Jev)",
        "https://typesafe.ai",
      );
    } else {
      const provider = resolveLoginProvider(arg) ?? model.provider;
      await promptAndSaveKey(provider);
    }
    rl.resume();
    return { model, mode, sessionId, handled: true };
  }

  if (command === "/memory") {
    console.log(`\n${formatMemorySummary()}\n`);
    return { model, mode, sessionId, handled: true };
  }

  if (command === "/projects") {
    console.log(`\n${formatProjectsList()}`);
    return { model, mode, sessionId, handled: true };
  }

  if (command === "/sessions") {
    console.log(`\n${formatSessionsList(process.cwd())}\n`);
    return { model, mode, sessionId, handled: true };
  }

  if (command === "/mcp") {
    console.log(`\n${ctx.mcp.formatList()}\n`);
    return { model, mode, sessionId, handled: true };
  }

  if (command === "/new") {
    ctx.history.length = 0;
    sessionId = createSessionId();
    console.log(dim(`   sesión nueva: ${sessionId}\n`));
    return { model, mode, sessionId, handled: true };
  }

  if (command === "/soul" || command === "/user" || command === "/behaviors") {
    const target = command.slice(1) as MemoryTarget;
    console.log(`\n${readGlobalFile(target)}\n`);
    return { model, mode, sessionId, handled: true };
  }

  if (command === "/mode") {
    if (!arg) {
      console.log(dim(`   modo: ${formatModeLabel(mode)} (agent | plan | yolo)\n`));
      return { model, mode, sessionId, handled: true };
    }
    const next = arg.toLowerCase();
    if (next === "agent" || next === "plan" || next === "yolo") {
      mode = next;
      console.log(dim(`   modo: ${formatModeLabel(mode)}\n`));
    } else {
      console.log(dim(`   no conozco "${arg}". Usa agent, plan o yolo.\n`));
    }
    return { model, mode, sessionId, handled: true };
  }

  if (command !== "/model" && command !== "/models") {
    return { model, mode, sessionId, handled: false };
  }

  if (!arg) {
    console.log(`\n${formatModelList(model.id)}\n`);
    console.log(dim(`   actual: ${formatModelLine(model)}`));
    console.log(dim("   ejemplo: /model haiku · /login minimax\n"));
    return { model, mode, sessionId, handled: true };
  }

  const next = resolveModel(arg);
  if (!next) {
    console.log(dim(`   no conozco "${arg}". Prueba /model para ver la lista.\n`));
    return { model, mode, sessionId, handled: true };
  }

  const ready = await ensureKeyForModel(next, rl);
  if (!ready) {
    console.log(dim(`   sin key de ${keyEnvFor(next.provider)}, sigo con ${model.alias}.\n`));
    return { model, mode, sessionId, handled: true };
  }

  console.log(dim(`   modelo: ${formatModelLine(next)}\n`));
  return { model: next, mode, sessionId, handled: true };
}

function resolveLoginProvider(raw: string): Provider | null {
  const needle = raw.trim().toLowerCase();
  if (!needle || needle === "anthropic" || needle === "claude") return "anthropic";
  if (needle === "minimax") return "minimax";
  return null;
}

function resolveTypesafeLogin(raw: string): boolean {
  const needle = raw.trim().toLowerCase();
  return needle === "typesafe" || needle === "jev";
}

function resolveInitialSession(
  cli: ReturnType<typeof parseArgs>,
  modelFromCli: ModelChoice | undefined,
): { history: History; sessionId: string; model: ModelChoice } {
  const cwd = process.cwd();
  if (cli.resume) {
    const loaded = loadSession(cli.resume);
    if (!loaded || loaded.cwd !== cwd) {
      console.error(`No encuentro la sesión "${cli.resume}" en este workspace.`);
      process.exit(1);
    }
    const restored = modelFromCli ?? resolveModel(loaded.model) ?? defaultModel();
    return { history: loaded.history, sessionId: loaded.id, model: restored };
  }
  if (cli.continueLast) {
    const latest = latestSessionForCwd(cwd);
    if (latest) {
      const restored = modelFromCli ?? resolveModel(latest.model) ?? defaultModel();
      return { history: latest.history, sessionId: latest.id, model: restored };
    }
  }
  return {
    history: [],
    sessionId: createSessionId(),
    model: modelFromCli ?? defaultModel(),
  };
}

function persistSession(
  sessionId: string,
  model: ModelChoice,
  history: History,
  titleSeed: string,
): void {
  const existing = loadSession(sessionId);
  const now = new Date().toISOString();
  const session: SessionFile = {
    id: sessionId,
    cwd: process.cwd(),
    model: model.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    title: existing?.title ?? titleFromMessage(titleSeed),
    history,
  };
  saveSession(session);
}

async function runUserTurn(options: {
  input: string;
  history: History;
  model: ModelChoice;
  mode: AgentMode;
  gate: ReturnType<typeof createGate>;
  checkpoints: ReturnType<typeof createCheckpointStore>;
  usage: ReturnType<typeof createUsageLedger>;
  registry: ToolRegistry;
  ask: (prompt: string) => Promise<string>;
}): Promise<void> {
  let turnModel = options.model;
  let turnNote: string | undefined;
  if (isAutoModel(options.model)) {
    const routed = await assessMessageComplexity(options.input);
    turnModel = routed.model;
    process.stdout.write(`\n${formatJevModelPick(turnModel, routed.reason)}\n`);
    turnNote = `jev → ${turnModel.label}`;
  }

  const turn = await runTurn(
    options.input,
    options.history,
    options.gate,
    turnModel,
    options.checkpoints,
    options.usage,
    { turnNote, mode: options.mode, registry: options.registry },
  );

  await maybeProposeAutoMemory(
    options.input,
    turn.rememberUserCalled,
    turnModel,
    options.ask,
  );
  console.log(dim(options.usage.turnLine()));
  console.log("");
}

function printStartupBanner(model: ModelChoice, mode: AgentMode, mcp: McpRuntime): void {
  printBanner();
  console.log(dim(`   workspace: ${process.cwd()}`));
  const memoryFiles = listMemoryFiles();
  console.log(
    dim(
      memoryFiles.length > 0
        ? `   memoria: ${memoryFiles.join(", ")}`
        : `   memoria: ninguna (puedes crear ${PROJECT_MEMORY_FILE})`,
    ),
  );
  if (isAutoModel(model)) {
    console.log(
      dim(
        `   modelo: auto · ${jevEnabled() ? "Jev elige Haiku/Sonnet/Opus en cada mensaje" : "sin Jev → Sonnet 4.5 por turno"}`,
      ),
    );
  } else {
    console.log(dim(`   modelo: ${formatModelLine(model)}`));
  }
  console.log(dim(`   modo: ${formatModeLabel(mode)}`));
  console.log(dim(`   ${jevBannerLine()}`));
  console.log(dim(`   ${mcp.bannerLine()}`));
  console.log(dim(`   memoria global: soul, user, behaviors (~/${CONFIG_DIR_NAME})`));
  console.log(
    dim(
      "   write, edit, bash, web_fetch, remember_user y MCP piden permiso (s / n / a).",
    ),
  );
  console.log(
    dim(
      "   /memory /projects /sessions /new /mcp /mode · /model · /login · /undo · /usage · /exit",
    ),
  );
  console.log("");
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseArgs(process.argv.slice(2));

  if (cli.command === "doctor") {
    const report = await runDoctor();
    console.log(`\n${formatDoctorReport(report.lines)}\n`);
    process.exit(report.exitCode);
  }

  if (cli.command === "sessions") {
    console.log(`\n${formatSessionsList(process.cwd())}\n`);
    return;
  }

  const mcp = await connectMcpServers((message) => {
    console.log(dim(`   ${message}`));
  });
  const registry = createToolRegistry({ mcpTools: mcp.tools });

  try {
    if (cli.command === "mcp") {
      console.log(`\n${mcp.formatList()}\n`);
      return;
    }

    let modelFromCli: ModelChoice | undefined;
    if (cli.model) {
      const chosen = resolveModel(cli.model);
      if (!chosen) {
        console.error(`No conozco el modelo "${cli.model}".`);
        console.error(formatModelList(""));
        process.exit(1);
      }
      modelFromCli = chosen;
    }

    const sessionBoot = resolveInitialSession(cli, modelFromCli);
    let model = sessionBoot.model;
    let mode: AgentMode = cli.mode;
    let sessionId = sessionBoot.sessionId;
    const history = sessionBoot.history;

    if (!cli.prompt && !anyProviderKey() && !cli.model) {
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

    const nonInteractive = !stdin.isTTY;
    let currentMode = mode;

    const makeGate = (ask: (prompt: string) => Promise<string>) =>
      createGate(ask, {
        assessRisk: jevEnabled() ? createAssessRisk(process.cwd()) : undefined,
        getMode: () => currentMode,
        nonInteractive,
      });

    if (cli.prompt) {
      printStartupBanner(model, currentMode, mcp);
      const rlOne = stdin.isTTY
        ? createInterface({ input: stdin, output: stdout })
        : null;
      const gate = makeGate(async (prompt) => {
        if (rlOne) {
          try {
            return await rlOne.question(prompt);
          } catch {
            return "n";
          }
        }
        return "n";
      });
      const checkpoints = createCheckpointStore();
      const usage = createUsageLedger();
      try {
        await runUserTurn({
          input: cli.prompt,
          history,
          model,
          mode: currentMode,
          gate,
          checkpoints,
          usage,
          registry,
          ask: async (prompt) => {
            if (!rlOne) return "n";
            try {
              return await rlOne.question(prompt);
            } catch {
              return "n";
            }
          },
        });
        persistSession(sessionId, model, history, cli.prompt);
        process.exit(0);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      } finally {
        rlOne?.close();
      }
    }

    printStartupBanner(model, currentMode, mcp);
    if (history.length > 0) {
      console.log(dim(`   sesión: ${sessionId} (${history.length} mensajes cargados)\n`));
    }

    const rl = createInterface({ input: stdin, output: stdout });
    const checkpoints = createCheckpointStore();
    const usage = createUsageLedger();
    const gate = makeGate(async (prompt) => {
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
          input = (await rl.question(promptPrefix(currentMode))).trim();
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

        const slash = await handleSlash(
          input,
          { model, mode: currentMode, sessionId, history, mcp },
          rl,
        );
        model = slash.model;
        currentMode = slash.mode;
        sessionId = slash.sessionId ?? sessionId;
        if (slash.handled) continue;

        try {
          await runUserTurn({
            input,
            history,
            model,
            mode: currentMode,
            gate,
            checkpoints,
            usage,
            registry,
            ask: async (prompt) => {
              try {
                return await rl.question(prompt);
              } catch {
                return "n";
              }
            },
          });
          persistSession(sessionId, model, history, input);
        } catch (error) {
          console.error(error instanceof Error ? error.message : error);
        }
      }
    } finally {
      rl.close();
    }
  } finally {
    await mcp.close();
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
