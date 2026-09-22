import Anthropic from "@anthropic-ai/sdk";
import { type CheckpointStore } from "../checkpoint.js";
import { compactIfNeeded } from "./compact.js";
import { loadProjectMemory } from "../memory.js";
import { APP_NAME, CONFIG_DIR_NAME, PROJECT_MEMORY_FILE } from "../config.js";
import { loadGlobalMemory } from "../userMemory.js";
import { type ModelChoice } from "../models.js";
import { type PermissionGate } from "../permissions.js";
import { createClient } from "../providers.js";
import { startSpinner } from "../spinner.js";
import { executeTool, TOOL_DEFINITIONS } from "../tools.js";
import { type UsageLedger } from "../usage.js";

const MAX_ITERATIONS = 20;

const SYSTEM_PROMPT = `You are ${APP_NAME}, a local coding agent.
You work inside the user's current workspace and use tools to inspect and edit files.
Prefer small, targeted edits over rewriting whole files.
If a tool fails, read the error and try another approach.
write, edit, bash, and remember_user need the user's approval. If they deny a tool, do not retry it unless they ask.

Global memory in ~/${CONFIG_DIR_NAME} (use remember_user, not write):
- soul.md: your identity as Quillami (voice, interests, what you have done). Not facts about the human.
- user.md: facts about the person (role, goals, preferences, projects from their perspective).
- behaviors.md: how you should interact (tone, length, workflows).

Repo memory: ${PROJECT_MEMORY_FILE} / AGENTS.md for this codebase only (use write with permission).
Do not update global memory every turn. Update when the user asks to remember something, or when a stable pattern is clear.
Never store API keys, tokens, .env contents, or bash secrets in any memory file.
Respond in the user's language.`;

export type History = Anthropic.MessageParam[];

export async function runTurn(
  userMessage: string,
  history: History,
  gate: PermissionGate,
  model: ModelChoice,
  checkpoints: CheckpointStore,
  usage: UsageLedger,
): Promise<void> {
  const client = createClient(model);

  history.push({ role: "user", content: userMessage });
  checkpoints.beginTurn();
  usage.beginTurn();

  try {
    await runToolLoop(client, model.id, history, gate, checkpoints, usage);
  } finally {
    checkpoints.finishTurn();
  }
}

async function runToolLoop(
  client: Anthropic,
  model: string,
  history: History,
  gate: PermissionGate,
  checkpoints: CheckpointStore,
  usage: UsageLedger,
): Promise<void> {
  for (let step = 0; step < MAX_ITERATIONS; step += 1) {
    await compactIfNeeded(client, model, history, usage);
    const response = await streamAssistant(client, model, history, usage);
    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const preview = summarizeInput(block.input);
      process.stdout.write(`\n· ${block.name}${preview ? ` ${preview}` : ""}\n`);

      const allowed = await gate.authorize(block.name, block.input);
      if (!allowed) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content:
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

      let output: string;
      try {
        output = await executeTool(block.name, block.input);
      } catch (error) {
        output = `Error: ${error instanceof Error ? error.message : String(error)}`;
      }

      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: output,
      });
    }

    history.push({ role: "user", content: results });
  }

  console.log("\nStopped: too many tool steps in this turn.");
}

async function streamAssistant(
  client: Anthropic,
  model: string,
  history: History,
  usage: UsageLedger,
): Promise<Anthropic.Message> {
  const stopSpinner = startSpinner();

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 8000,
      system: buildSystemPrompt(),
      tools: TOOL_DEFINITIONS,
      messages: history,
    });

    let started = false;
    stream.on("text", (delta) => {
      if (!started) {
        stopSpinner();
        process.stdout.write("\n");
        started = true;
      }
      process.stdout.write(delta);
    });

    const message = await stream.finalMessage();
    usage.record(model, message.usage);
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

function buildSystemPrompt(): string {
  const globalMem = loadGlobalMemory();
  const projectMem = loadProjectMemory();
  const parts = [SYSTEM_PROMPT];

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
  const value = record.path ?? record.command ?? record.pattern ?? record.target;
  return typeof value === "string" ? value : "";
}
