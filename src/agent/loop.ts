import Anthropic from "@anthropic-ai/sdk";
import { type CheckpointStore } from "../checkpoint.js";
import { cachedMessages, cachedSystem, cachedTools } from "./cache.js";
import { compactIfNeeded } from "./compact.js";
import { loadProjectMemory } from "../memory.js";
import { APP_NAME, CONFIG_DIR_NAME, PROJECT_MEMORY_FILE } from "../config.js";
import { loadGlobalMemory } from "../userMemory.js";
import { type ModelChoice } from "../models.js";
import type { AgentMode } from "../mode.js";
import { type PermissionGate } from "../permissions.js";
import { createClient } from "../providers.js";
import { startSpinner } from "../spinner.js";
import { defaultToolRegistry, type ToolRegistry } from "../toolRegistry.js";
import { dim } from "../banner.js";
import { formatServedModel } from "../jev.js";
import { createLiveTail, formatDuration } from "../liveOutput.js";
import { isOpenRouterId } from "../openrouter.js";
import { truncateMiddle } from "../truncate.js";
import { reportedCostUsd, type UsageLedger } from "../usage.js";

const MAX_ITERATIONS = 20;

const SYSTEM_PROMPT = `You are ${APP_NAME}, a local coding agent.
You work inside the user's current workspace and use tools to inspect and edit files.
Prefer small, targeted edits over rewriting whole files.
If a tool fails, read the error and try another approach.
write, edit, bash, web_fetch, remember_user, and MCP tools need the user's approval. If they deny a tool, do not retry it unless they ask.

Global memory in ~/${CONFIG_DIR_NAME} (use remember_user, not write):
- soul.md: your identity as Quillami (voice, interests, what you have done). Not facts about the human.
- user.md: facts about the person (role, goals, preferences, projects from their perspective).
- behaviors.md: how you should interact (tone, length, workflows).

Repo memory: ${PROJECT_MEMORY_FILE} / AGENTS.md for this codebase only (use write with permission).
Do not update global memory every turn. Update when the user asks to remember something, or when a stable pattern is clear.
Never store API keys, tokens, .env contents, or bash secrets in any memory file.
Respond in the user's language.`;

const PLAN_ADDENDUM = `Plan mode: use read-only tools (read, grep, glob, ls) to investigate.
Do not call write, edit, bash, web_fetch, remember_user, or MCP tools.
Finish with a clear, actionable plan for the user; do not execute changes yourself.`;

export type History = Anthropic.MessageParam[];

export type TurnResult = {
  rememberUserCalled: boolean;
  interrupted: boolean;
};

export type RunTurnOptions = {
  turnNote?: string;
  mode?: AgentMode;
  registry?: ToolRegistry;
  client?: Anthropic;
  signal?: AbortSignal;
};

type LoopState = {
  rememberUserCalled: boolean;
  partialText: string;
  /** Last model OpenRouter actually served this turn (routers and ~aliases pick one). */
  servedModel?: string;
};

const INTERRUPTED_NOTE = "[The user interrupted this turn before it finished.]";
const CANCELLED_TOOL_MESSAGE = "Not run: the user interrupted the turn.";

export async function runTurn(
  userMessage: string,
  history: History,
  gate: PermissionGate,
  model: ModelChoice,
  checkpoints: CheckpointStore,
  usage: UsageLedger,
  options?: RunTurnOptions,
): Promise<TurnResult> {
  const client = options?.client ?? createClient(model);
  const mode = options?.mode ?? "agent";
  const registry = options?.registry ?? defaultToolRegistry();

  // Compaction rewrites history in place, so restore from a copy, not by length.
  const before = history.slice();
  history.push({ role: "user", content: userMessage });
  checkpoints.beginTurn();
  usage.beginTurn({
    turnNote: options?.turnNote,
  });

  const signal = options?.signal;
  const state: LoopState = { rememberUserCalled: false, partialText: "" };
  try {
    await runToolLoop(
      client,
      model.id,
      history,
      gate,
      checkpoints,
      usage,
      registry,
      mode,
      state,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) {
      closeInterruptedTurn(history, state.partialText);
      return { rememberUserCalled: state.rememberUserCalled, interrupted: true };
    }
    history.splice(0, history.length, ...before);
    throw error;
  } finally {
    checkpoints.finishTurn();
  }
  return { rememberUserCalled: state.rememberUserCalled, interrupted: false };
}

/**
 * Files may already have changed, so an interrupted turn stays in history
 * instead of being rolled back; it only needs to end on an assistant message.
 */
function closeInterruptedTurn(history: History, partialText: string): void {
  const last = history[history.length - 1];
  if (last?.role === "assistant") return;
  const text = partialText.trim();
  history.push({
    role: "assistant",
    content: text ? `${text}\n\n${INTERRUPTED_NOTE}` : INTERRUPTED_NOTE,
  });
}

async function runToolLoop(
  client: Anthropic,
  model: string,
  history: History,
  gate: PermissionGate,
  checkpoints: CheckpointStore,
  usage: UsageLedger,
  registry: ToolRegistry,
  mode: AgentMode,
  state: LoopState,
  signal?: AbortSignal,
): Promise<void> {
  for (let step = 0; step < MAX_ITERATIONS; step += 1) {
    await compactIfNeeded(client, model, history, usage, signal);
    signal?.throwIfAborted();
    state.partialText = "";
    const response = await streamAssistant(
      client,
      model,
      history,
      usage,
      registry,
      mode,
      state,
      signal,
    );
    history.push({ role: "assistant", content: response.content });
    state.partialText = "";

    if (response.stop_reason !== "tool_use") {
      return;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      if (signal?.aborted) {
        results.push(cancelledResult(block.id));
        continue;
      }

      const preview = summarizeInput(block.input);
      process.stdout.write(`\n· ${block.name}${preview ? ` ${preview}` : ""}\n`);

      let decision: Awaited<ReturnType<PermissionGate["authorize"]>>;
      try {
        decision = await gate.authorize(block.name, block.input);
      } catch (error) {
        if (!signal?.aborted) throw error;
        results.push(cancelledResult(block.id));
        continue;
      }
      if (signal?.aborted) {
        results.push(cancelledResult(block.id));
        continue;
      }
      if (!decision.allowed) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content:
            decision.toolMessage ??
            "The user denied this action. Do not retry it unless they explicitly ask.",
        });
        continue;
      }

      if (block.name === "write" || block.name === "edit") {
        const target = filePathOf(block.input);
        if (target) {
          await checkpoints.snapshot(target);
        }
      }

      const live = block.name === "bash" && process.stdout.isTTY ? createLiveTail() : null;
      const stopLive = () => live?.stop();
      signal?.addEventListener("abort", stopLive, { once: true });
      const startedAt = Date.now();
      let output: string;
      try {
        output = await registry.execute(block.name, block.input, {
          signal,
          onOutput: live ? (chunk) => live.push(chunk) : undefined,
        });
      } catch (error) {
        output = signal?.aborted
          ? CANCELLED_TOOL_MESSAGE
          : `Error: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        signal?.removeEventListener("abort", stopLive);
      }
      if (live) {
        const lineCount = live.stop();
        process.stdout.write(`${dim(formatBashSummary(output, Date.now() - startedAt, lineCount))}\n`);
      }

      if (block.name === "remember_user") {
        state.rememberUserCalled = true;
      }

      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: truncateMiddle(output),
      });
    }

    history.push({ role: "user", content: results });
    signal?.throwIfAborted();
  }

  console.log("\nStopped: too many tool steps in this turn.");
}

export function formatBashSummary(output: string, elapsedMs: number, lineCount: number): string {
  const exit = /^exit (.+)$/m.exec(output)?.[1] ?? "?";
  const lines = `${lineCount} ${lineCount === 1 ? "línea" : "líneas"}`;
  const stopped = /stopped after (\d+)s timeout/.test(output)
    ? " · se pasó del tiempo"
    : /the user cancelled/.test(output)
      ? " · cancelado"
      : "";
  return `  exit ${exit} · ${formatDuration(elapsedMs)} · ${lines}${stopped}`;
}

function cancelledResult(toolUseId: string): Anthropic.ToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, content: CANCELLED_TOOL_MESSAGE };
}

async function streamAssistant(
  client: Anthropic,
  model: string,
  history: History,
  usage: UsageLedger,
  registry: ToolRegistry,
  mode: AgentMode,
  state: LoopState,
  signal?: AbortSignal,
): Promise<Anthropic.Message> {
  let stopSpinner = startSpinner();

  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 8000,
        system: cachedSystem(buildSystemPrompt(mode)),
        tools: cachedTools(registry.definitions(mode)),
        messages: cachedMessages(history),
      },
      { signal },
    );

    let started = false;
    stream.on("text", (delta) => {
      if (!started) {
        stopSpinner();
        process.stdout.write("\n");
        started = true;
      }
      state.partialText += delta;
      process.stdout.write(delta);
    });

    // The SDK drops OpenRouter's extra usage fields when it assembles the message.
    let reportedCost: number | undefined;
    stream.on("streamEvent", (event) => {
      if (event.type === "message_delta") {
        reportedCost = reportedCostUsd(event.usage);
        return;
      }
      if (event.type !== "message_start" || !isOpenRouterId(model)) return;
      const served = event.message.model;
      if (!served || served === model || served === state.servedModel) return;
      state.servedModel = served;
      stopSpinner();
      process.stdout.write(`${dim(formatServedModel(model, served))}\n`);
      stopSpinner = startSpinner();
    });

    const message = await stream.finalMessage();
    usage.record(
      model,
      reportedCost === undefined ? message.usage : { ...message.usage, cost: reportedCost },
    );
    stopSpinner();
    if (started) {
      process.stdout.write("\n");
    }
    return message;
  } catch (error) {
    stopSpinner();
    throw error;
  }
}

function buildSystemPrompt(mode: AgentMode): string {
  const globalMem = loadGlobalMemory();
  const projectMem = loadProjectMemory();
  const parts = [SYSTEM_PROMPT];
  if (mode === "plan") {
    parts.push(PLAN_ADDENDUM);
  }

  if (globalMem.body) {
    parts.push(globalMem.body);
    if (globalMem.truncated) {
      parts.push(
        `(Some global memory files were truncated in this prompt; full files live under ~/${CONFIG_DIR_NAME}.)`,
      );
    }
  }

  if (projectMem) {
    parts.push(
      `Project memory. Treat this as the source of truth for how this repo works:\n\n${projectMem}`,
    );
  } else {
    parts.push(
      `There is no ${PROJECT_MEMORY_FILE} or AGENTS.md in this workspace yet. If the user wants durable notes about the project, create ${PROJECT_MEMORY_FILE}.`,
    );
  }

  return parts.join("\n\n");
}

function filePathOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const path = (input as Record<string, unknown>).path;
  return typeof path === "string" && path.length > 0 ? path : null;
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const value =
    record.path ?? record.command ?? record.pattern ?? record.target ?? record.url;
  return typeof value === "string" ? value : "";
}
