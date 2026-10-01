import Anthropic from "@anthropic-ai/sdk";
import { dim } from "../banner.js";
import { startSpinner } from "../spinner.js";
import { estimateTokens, formatTokenCount } from "../tokens.js";
import { type UsageLedger } from "../usage.js";

const COMPACT_AFTER_TOKENS = 20_000;
const KEEP_TAIL_TOKENS = 7_000;
const MAX_TRANSCRIPT_TOKENS = 15_000;
const MAX_MESSAGE_IN_TRANSCRIPT_TOKENS = 500;

export async function compactIfNeeded(
  client: Anthropic,
  model: string,
  history: Anthropic.MessageParam[],
  usage?: UsageLedger,
  signal?: AbortSignal,
): Promise<void> {
  const before = totalTokens(history);
  if (before < COMPACT_AFTER_TOKENS) {
    return;
  }

  const cut = findTailStart(history);
  if (cut <= 0) {
    return;
  }

  const prefix = history.slice(0, cut);
  const tail = history.slice(cut);
  const stopSpinner = startSpinner("Compactando el historial…");

  try {
    const summary = await summarizePrefix(client, model, prefix, usage, signal);
    history.splice(
      0,
      history.length,
      {
        role: "user",
        content: `Resumen de la conversación anterior. Úsalo como contexto y no lo contradigas:\n\n${summary}`,
      },
      {
        role: "assistant",
        content: "Entendido. Sigo desde ese resumen.",
      },
      ...tail,
    );
    const after = totalTokens(history);
    process.stdout.write(
      `${dim(`  Historial compactado (${formatTokenCount(before)} → ${formatTokenCount(after)} tokens).`)}\n`,
    );
  } catch {
    // If the summary call fails, keep the full history and continue.
  } finally {
    stopSpinner();
  }
}

export function findTailStart(history: Anthropic.MessageParam[]): number {
  let tokens = 0;
  let index = history.length;

  while (index > 0 && tokens < KEEP_TAIL_TOKENS) {
    index -= 1;
    tokens += messageTokens(history[index]);
  }

  while (index > 0 && isToolResultMessage(history[index])) {
    index -= 1;
  }

  if (index < 2) {
    return -1;
  }

  return index;
}

async function summarizePrefix(
  client: Anthropic,
  model: string,
  prefix: Anthropic.MessageParam[],
  usage?: UsageLedger,
  signal?: AbortSignal,
): Promise<string> {
  const response = await client.messages.create(
    {
      model,
      max_tokens: 800,
      system:
        "Summarize this coding-agent conversation for a later session. Keep user goals, files touched, decisions, errors, and what is still pending. Be concise. Use the user's language.",
      messages: [
        {
          role: "user",
          content: toTranscript(prefix),
        },
      ],
    },
    { signal },
  );

  usage?.record(model, response.usage);

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("empty summary");
  }

  return text;
}

function toTranscript(messages: Anthropic.MessageParam[]): string {
  const maxMessageChars = MAX_MESSAGE_IN_TRANSCRIPT_TOKENS * 4;
  const maxTranscriptChars = MAX_TRANSCRIPT_TOKENS * 4;
  const parts = messages.map((message) => {
    const body = flattenContent(message.content).slice(0, maxMessageChars);
    return `${message.role}: ${body}`;
  });

  let transcript = parts.join("\n\n");
  if (estimateTokens(transcript) > MAX_TRANSCRIPT_TOKENS) {
    transcript = transcript.slice(-maxTranscriptChars);
  }
  return transcript;
}

function flattenContent(content: Anthropic.MessageParam["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "tool_use") {
        return `[tool ${block.name} ${summarizeToolInput(block.input)}]`;
      }
      if (block.type === "tool_result") {
        const body =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
        return `[tool_result ${body}]`;
      }
      return `[${block.type}]`;
    })
    .join("\n");
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const value = record.path ?? record.command ?? record.pattern;
  return typeof value === "string" ? value : "";
}

function isToolResultMessage(message: Anthropic.MessageParam): boolean {
  if (message.role !== "user" || typeof message.content === "string") {
    return false;
  }
  return message.content.some((block) => block.type === "tool_result");
}

function messageTokens(message: Anthropic.MessageParam): number {
  return estimateTokens(flattenContent(message.content));
}

function totalTokens(history: Anthropic.MessageParam[]): number {
  return history.reduce((sum, message) => sum + messageTokens(message), 0);
}
