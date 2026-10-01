import Anthropic from "@anthropic-ai/sdk";
import { dim } from "./banner.js";
import {
  assessMemorySignals,
  looksLikeSecret,
  shouldProposeAutoMemory,
} from "./decisions.js";
import { jevEnabled } from "./jev.js";
import { type ModelChoice } from "./models.js";
import { createClient } from "./providers.js";
import { CONFIG_DIR_NAME } from "./config.js";
import { rememberUser, type MemoryTarget } from "./userMemory.js";

export type AskFn = (prompt: string) => Promise<string>;

export async function maybeProposeAutoMemory(
  userMessage: string,
  rememberUserCalled: boolean,
  model: ModelChoice,
  ask: AskFn,
): Promise<void> {
  if (rememberUserCalled || !jevEnabled()) return;

  const nouls = await assessMemorySignals(userMessage);
  const proposal = shouldProposeAutoMemory(nouls, userMessage);
  if (!proposal) return;

  const line = await draftMemoryLine(createClient(model), model.id, userMessage, proposal.target);
  if (!line || looksLikeSecret(line)) return;

  const file =
    proposal.target === "user" ? "user.md" : "behaviors.md";
  process.stdout.write(
    `\n${dim(`¿Guardo en ~/${CONFIG_DIR_NAME}/${file}: "${line}"? (s/n)`)}\n`,
  );

  const raw = (await ask("  ")).trim().toLowerCase();
  if (raw !== "s" && raw !== "si" && raw !== "sí" && raw !== "y" && raw !== "yes") {
    process.stdout.write(`${dim("  Ok, no guardo.\n")}\n`);
    return;
  }

  await rememberUser({
    target: proposal.target,
    mode: "append",
    content: line,
  });
  process.stdout.write(`${dim(`  Guardado en ${file}.\n`)}\n`);
}

async function draftMemoryLine(
  client: Anthropic,
  modelId: string,
  userMessage: string,
  target: MemoryTarget,
): Promise<string | null> {
  const kind =
    target === "user"
      ? "one durable fact about the user"
      : "one durable preference for how the assistant should behave";

  try {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content:
            `Redact exactly one short line (${kind}) to remember from the message below. ` +
            "No quotes, no secrets, no API keys. Plain text only.\n\n" +
            userMessage,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    return block.text.trim().split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}
