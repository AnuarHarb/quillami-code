#!/usr/bin/env node
import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dim, printBanner } from "./banner.js";
import { CONFIG_DIR_NAME, PROJECT_MEMORY_FILE } from "./config.js";
import { maybeProposeAutoMemory } from "./autoMemory.js";
import { runTurn, type History } from "./agent/loop.js";
import { parseArgs } from "./cli.js";
import { BENCHMARK_ATTRIBUTION, benchmarksEnabled, loadBenchmarks } from "./benchmarks.js";
import {
  assessMessageComplexity,
  formatAutoPick,
  stickToPrevious,
  type AutoPick,
} from "./decisions.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import {
  hasKey,
  promptAndSaveKey,
  promptAndSaveNamedKey,
  readHidden,
  saveUserKey,
} from "./auth.js";
import { jevBannerLine, jevEnabled } from "./jev.js";
import { createCheckpointStore, type UndoResult } from "./checkpoint.js";
import { loadEnv } from "./env.js";
import { listMemoryFiles } from "./memory.js";
import {
  connectMcpServers,
  enabledMcpServerNames,
  type McpRuntime,
} from "./mcp.js";
import {
  autoTiers,
  defaultModel,
  formatModelLine,
  formatModelList,
  isAutoModel,
  resolveModel,
  type ModelChoice,
} from "./models.js";
import { pickModel } from "./modelPicker.js";
import { formatModeLabel, promptPrefix, type AgentMode } from "./mode.js";
import { createTurnInterrupter, type TurnInterrupter } from "./interrupt.js";
import {
  KEY_SLOTS,
  markOnboardingDone,
  onboardingDone,
  runOnboarding,
  type OnboardingIO,
} from "./onboarding.js";
import { createAssessRisk, createGate } from "./permissions.js";
import {
  featuredOpenRouterModels,
  formatOpenRouterModels,
  loadOpenRouterCatalog,
  searchOpenRouterModels,
} from "./openrouter.js";
import { anyProviderKey, keyEnvFor, type Provider } from "./providers.js";
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
import { estimateTokens } from "./tokens.js";
import { createUsageLedger } from "./usage.js";
import {
  ensureTemplates,
  formatMemorySummary,
  formatProjectsList,
  readGlobalFile,
  touchProjectRegistry,
  type MemoryTarget,
} from "./userMemory.js";

/** Before the REPL exists: one short-lived readline per question, so hidden key input owns stdin. */
function startupIO(): OnboardingIO {
  return {
    ask: async (prompt) => {
      const rl = createInterface({ input: stdin, output: stdout });
      rl.on("SIGINT", () => {
        rl.close();
        console.log("");
        process.exit(130);
      });
      try {
        return await rl.question(prompt);
      } catch {
        console.log("");
        process.exit(130);
      } finally {
        rl.close();
      }
    },
    secret: (prompt) => readHidden(prompt).catch(() => null),
    print: (text) => console.log(text),
  };
}

function replIO(rl: Interface): OnboardingIO {
  return {
    ask: (prompt) => rl.question(prompt).catch(() => ""),
    secret: async (prompt) => {
      rl.pause();
      try {
        return await readHidden(prompt);
      } catch {
        return null;
      } finally {
        rl.resume();
      }
    },
    print: (text) => console.log(text),
  };
}

/**
 * Interactive model choice: picker, key check, catalog check, and the saved
 * default (`always` during setup, `ask` from /model).
 */
async function chooseModel(options: {
  io: OnboardingIO;
  current?: ModelChoice;
  query?: string;
  saveDefault: "always" | "ask";
  rl?: Interface;
}): Promise<ModelChoice | null> {
  const catalog = await loadOpenRouterCatalog();
  const picked = await pickModel({
    ask: options.io.ask,
    print: options.io.print,
    currentId: options.current?.id,
    catalog,
    query: options.query,
  });
  if (!picked) return null;
  const resolved = resolveModel(picked);
  if (!resolved) return null;

  if (!(await ensureKeyForModel(resolved, options.rl))) {
    console.log(dim(`   sin key de ${keyEnvFor(resolved.provider)}.`));
    return null;
  }
  const checked = await checkOpenRouterModel(resolved);
  if (!checked.ok) return null;
  if (isAutoModel(checked.model)) await ensureJevKeyForAuto(options.rl);

  const saveIt =
    options.saveDefault === "always" ||
    /^s/i.test((await options.io.ask("¿Lo dejo por defecto para las próximas sesiones? (s/N): ")).trim());
  if (saveIt) {
    saveUserKey("QUILLAMI_MODEL", checked.model.alias);
    process.env.QUILLAMI_MODEL = checked.model.alias;
    console.log(dim(`   modelo por defecto: ${checked.model.alias}`));
  }
  return checked.model;
}

/** Keys first, then (if a model key was added) the model to start with. */
async function runSetup(
  io: OnboardingIO,
  options: { current?: ModelChoice; rl?: Interface; pickModel: boolean },
): Promise<ModelChoice | null> {
  const result = await runOnboarding(io);
  if (result.hasModelKey) markOnboardingDone();
  const addedModelKey = result.added.some(
    (id) => KEY_SLOTS.find((slot) => slot.id === id)?.model,
  );
  const addedAutoKey = result.added.includes("typesafe") || result.added.includes("artificialanalysis");
  const offerAuto = addedAutoKey && result.hasModelKey && !(options.current && isAutoModel(options.current));
  if (!(addedModelKey || offerAuto) || !options.pickModel) return null;

  io.print("\n¿Con qué modelo arrancas? Lo dejo por defecto; luego lo cambias con /model.");
  if (resolveModel("auto")) {
    io.print(
      dim(
        process.env.TYPESAFE_API_KEY?.trim()
          ? "   Recomendado: 1 (auto): Jev elige el mejor modelo para cada tarea."
          : "   auto (1) necesita tu key de Jev; sin ella, elige un modelo fijo.",
      ),
    );
  }
  return chooseModel({ io, current: options.current, saveDefault: "always", rl: options.rl });
}

/**
 * Checks an OpenRouter id against the public catalog and returns the model
 * re-resolved with catalog pricing. Without the catalog (offline) it lets the
 * id through; the API will reject a bad one.
 */
async function checkOpenRouterModel(
  model: ModelChoice,
): Promise<{ ok: boolean; model: ModelChoice }> {
  if (model.provider !== "openrouter" || isAutoModel(model)) return { ok: true, model };
  const catalog = await loadOpenRouterCatalog();
  if (!catalog) {
    console.log(dim("   no pude leer el catálogo de OpenRouter; sigo sin precios."));
    return { ok: true, model };
  }
  const known = catalog.find((entry) => entry.id === model.id);
  if (!known) {
    console.log(dim(`   OpenRouter no tiene "${model.id}".`));
    const hint = model.id.split("/").pop() ?? model.id;
    const similar = searchOpenRouterModels(catalog, hint.split(/[-.:]/)[0] ?? hint, 8);
    if (similar.length > 0) {
      console.log(dim("   parecidos:"));
      console.log(dim(formatOpenRouterModels(similar)));
    }
    console.log(dim("   busca con /models <texto> (o quillami models <texto>)\n"));
    return { ok: false, model };
  }
  if (!known.tools) {
    console.log(
      dim(`   ojo: ${model.id} no soporta tools; no voy a poder leer, buscar ni editar archivos.`),
    );
  }
  return { ok: true, model: resolveModel(model.alias) ?? model };
}

async function printOpenRouterSearch(query: string): Promise<void> {
  const catalog = await loadOpenRouterCatalog();
  if (!catalog) {
    console.log(dim("   no pude leer el catálogo de OpenRouter (https://openrouter.ai/models).\n"));
    return;
  }
  const found = query.trim()
    ? searchOpenRouterModels(catalog, query)
    : featuredOpenRouterModels(catalog);
  console.log(`\n${formatOpenRouterModels(found)}\n`);
  console.log(dim("   precios en USD por millón de tokens (entrada / salida). Usa: /model <id>"));
  if (!query.trim()) console.log(dim("   busca más: quillami models <texto> (ej. qwen coder, deepseek, gemini)"));
  console.log("");
}

/** auto without Jev still runs (always the standard tier), so a missing key is offered, not required. */
async function ensureJevKeyForAuto(rl?: Interface): Promise<void> {
  if (process.env.TYPESAFE_API_KEY?.trim()) return;
  console.log(dim("\n   auto usa Jev para elegir el mejor modelo en cada tarea."));
  if (rl) rl.pause();
  const saved = await promptAndSaveNamedKey("TYPESAFE_API_KEY", "TypeSafe (Jev)", "https://typesafe.ai");
  if (rl) rl.resume();
  if (!saved) console.log(dim("   sin key de Jev, auto usa Sonnet en cada turno. Añádela luego con /setup."));
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

  if (command === "/setup") {
    const picked = await runSetup(replIO(rl), { current: model, rl, pickModel: true });
    if (picked) {
      model = picked;
      console.log(dim(`   modelo: ${formatModelLine(model)}`));
    }
    console.log("");
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

  if (command === "/models" || !arg) {
    console.log(dim(`\n   actual: ${formatModelLine(model)}`));
    const picked = await chooseModel({
      io: replIO(rl),
      current: model,
      query: command === "/models" && arg ? arg : undefined,
      saveDefault: "ask",
      rl,
    });
    if (picked) model = picked;
    console.log(dim(`   modelo: ${formatModelLine(model)}\n`));
    return { model, mode, sessionId, handled: true };
  }

  const resolved = resolveModel(arg);
  if (!resolved) {
    console.log(
      dim(`   no conozco "${arg}". Prueba /model para la lista o /models ${arg} en OpenRouter.\n`),
    );
    return { model, mode, sessionId, handled: true };
  }

  const ready = await ensureKeyForModel(resolved, rl);
  if (!ready) {
    console.log(dim(`   sin key de ${keyEnvFor(resolved.provider)}, sigo con ${model.alias}.\n`));
    return { model, mode, sessionId, handled: true };
  }

  const checked = await checkOpenRouterModel(resolved);
  if (!checked.ok) {
    console.log(dim(`   sigo con ${model.alias}.\n`));
    return { model, mode, sessionId, handled: true };
  }

  console.log(dim(`   modelo: ${formatModelLine(checked.model)}\n`));
  return { model: checked.model, mode, sessionId, handled: true };
}

function resolveLoginProvider(raw: string): Provider | null {
  const needle = raw.trim().toLowerCase();
  if (!needle || needle === "anthropic" || needle === "claude") return "anthropic";
  if (needle === "minimax") return "minimax";
  if (needle === "openrouter" || needle === "or") return "openrouter";
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
    model: model.alias,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    title: existing?.title ?? titleFromMessage(titleSeed),
    history,
  };
  saveSession(session);
}

type AutoState = { last: { pick: AutoPick; at: number } | null };

/** Rough prompt size of the next request: history plus system prompt and tool definitions. */
function estimateContextTokens(history: History): number {
  return estimateTokens(JSON.stringify(history)) + 1_500;
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
  signal?: AbortSignal;
  /** Last auto pick of this session, so the next one can keep its prompt cache. */
  autoState?: AutoState;
}): Promise<{ interrupted: boolean }> {
  let turnModel = options.model;
  let turnNote: string | undefined;
  let autoPick: AutoPick | undefined;
  if (isAutoModel(options.model)) {
    const fresh = await assessMessageComplexity(options.input, options.model.provider);
    const previous = options.history.length > 0 ? (options.autoState?.last ?? null) : null;
    autoPick = stickToPrevious(previous, fresh, {
      tokens: estimateContextTokens(options.history),
      now: Date.now(),
    });
    turnModel = autoPick.model;
    process.stdout.write(`\n${formatAutoPick(autoPick)}\n`);
    turnNote = `jev → ${turnModel.label}`;
    const baseline = autoTiers(options.model.provider).standard;
    options.usage.setAutoRoute({
      label: turnModel.label,
      detail: autoPick.benchmark ? `índice ${autoPick.benchmark.intelligence.toFixed(1)}` : undefined,
      baseline: { model: baseline.id, label: baseline.label },
    });
  } else {
    options.usage.setAutoRoute(null);
  }

  const turn = await runTurn(
    options.input,
    options.history,
    options.gate,
    turnModel,
    options.checkpoints,
    options.usage,
    {
      turnNote,
      mode: options.mode,
      registry: options.registry,
      signal: options.signal,
    },
  );

  if (autoPick && options.autoState) options.autoState.last = { pick: autoPick, at: Date.now() };
  if (turn.interrupted) {
    console.log(dim("  turno cancelado; la sesión sigue."));
  } else {
    await maybeProposeAutoMemory(
      options.input,
      turn.rememberUserCalled,
      turnModel,
      options.ask,
    );
  }
  console.log(dim(options.usage.turnLine()));
  console.log("");
  return { interrupted: turn.interrupted };
}

/** rl.close() does not always settle a pending question, so closing also resolves it. */
function questionOrClose(rl: Interface, prompt: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const onClose = () => resolve(null);
    rl.once("close", onClose);
    rl.question(prompt).then(
      (line) => {
        rl.off("close", onClose);
        resolve(line);
      },
      (error: unknown) => {
        rl.off("close", onClose);
        reject(error);
      },
    );
  });
}

function questionInTurn(
  rl: Interface,
  interrupter: TurnInterrupter,
): (prompt: string) => Promise<string> {
  return async (prompt) => {
    const signal = interrupter.signal();
    try {
      return await rl.question(prompt, signal ? { signal } : {});
    } catch (error) {
      if (signal?.aborted) throw error;
      return "n";
    }
  };
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
    const via = model.provider === "openrouter" ? " vía OpenRouter" : "";
    const how = !jevEnabled()
      ? "sin key de Jev usa Sonnet siempre (/setup para añadirla)"
      : benchmarksEnabled()
        ? `Jev mide la dificultad y elige el modelo más barato que la cumple · ${BENCHMARK_ATTRIBUTION}`
        : `Jev elige Haiku, Sonnet u Opus${via} en cada mensaje`;
    console.log(dim(`   modelo: auto · ${how}`));
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
      "   /model elige modelo (OpenRouter incluido) · /setup keys · /memory /sessions /new /mcp /mode · /undo · /usage · /exit",
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

  if (cli.command === "models") {
    await printOpenRouterSearch(cli.query ?? "");
    return;
  }

  const interactive = Boolean(stdin.isTTY && stdout.isTTY);
  if (cli.command === "setup") {
    if (!interactive) {
      console.error("quillami setup necesita una terminal interactiva.");
      process.exit(1);
    }
    await runSetup(startupIO(), { current: defaultModel(), pickModel: true });
    console.log(dim("\n   Listo. Corre quillami para empezar.\n"));
    return;
  }

  if (
    interactive &&
    cli.command === "chat" &&
    !cli.prompt &&
    (!onboardingDone() || !anyProviderKey())
  ) {
    await runSetup(startupIO(), { pickModel: !cli.model });
    if (!anyProviderKey()) {
      console.error("\nSin una key de modelo no puedo arrancar. Corre quillami setup cuando la tengas.");
      process.exit(1);
    }
    console.log("");
  }

  const mcpNames = enabledMcpServerNames();
  if (mcpNames.length > 0) {
    console.log(dim(`   conectando MCP: ${mcpNames.join(", ")}…`));
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

    if (!(await ensureKeyForModel(model))) {
      console.error(`Necesitas ${keyEnvFor(model.provider)} para usar ${model.label}.`);
      process.exit(1);
    }

    const checked = await checkOpenRouterModel(model);
    if (!checked.ok) process.exit(1);
    model = checked.model;

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
      const interrupter = createTurnInterrupter({ rl: rlOne });
      const ask = rlOne
        ? questionInTurn(rlOne, interrupter)
        : async () => "n";
      const gate = makeGate(ask);
      const checkpoints = createCheckpointStore();
      const usage = createUsageLedger();
      try {
        const result = await interrupter.run((signal) =>
          runUserTurn({
            input: cli.prompt as string,
            history,
            model,
            mode: currentMode,
            gate,
            checkpoints,
            usage,
            registry,
            ask,
            signal,
          }),
        );
        persistSession(sessionId, model, history, cli.prompt);
        process.exit(!result || result.interrupted ? 130 : 0);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      } finally {
        interrupter.dispose();
        rlOne?.close();
      }
    }

    if (isAutoModel(model) && benchmarksEnabled() && jevEnabled()) {
      void Promise.all([loadOpenRouterCatalog(), loadBenchmarks()]);
    }
    printStartupBanner(model, currentMode, mcp);
    if (history.length > 0) {
      console.log(dim(`   sesión: ${sessionId} (${history.length} mensajes cargados)\n`));
    }

    const rl = createInterface({ input: stdin, output: stdout });
    const interrupter = createTurnInterrupter({ rl });
    const ask = questionInTurn(rl, interrupter);
    const checkpoints = createCheckpointStore();
    const usage = createUsageLedger();
    const gate = makeGate(ask);
    const autoState: AutoState = { last: null };

    try {
      while (true) {
        let input: string;
        try {
          if (stdin.readableEnded) break;
          const line = await questionOrClose(rl, promptPrefix(currentMode));
          if (line === null) break;
          input = line.trim();
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
          await interrupter.run((signal) =>
            runUserTurn({
              input,
              history,
              model,
              mode: currentMode,
              gate,
              checkpoints,
              usage,
              registry,
              ask,
              signal,
              autoState,
            }),
          );
          persistSession(sessionId, model, history, input);
        } catch (error) {
          console.error(error instanceof Error ? error.message : error);
        }
      }
    } finally {
      interrupter.dispose();
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
