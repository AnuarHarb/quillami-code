import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runTurn, type History } from "../src/agent/loop.ts";
import { createCheckpointStore } from "../src/checkpoint.ts";
import { MODELS } from "../src/models.ts";
import { createGate } from "../src/permissions.ts";
import { createUsageLedger } from "../src/usage.ts";
import { withWorkspace } from "./workspace.ts";

describe("runTurn", () => {
  it("restores the full history when a turn fails after compaction", async () => {
    await withWorkspace(async () => {
      const history: History = [
        { role: "user", content: "A".repeat(40_000) },
        { role: "assistant", content: "B".repeat(40_000) },
        { role: "user", content: "C".repeat(15_000) },
        { role: "assistant", content: "D".repeat(15_000) },
      ];
      const original = structuredClone(history);
      let firstMessageSent = "";

      const client = {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: "Resumen corto." }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          stream: (params: Anthropic.MessageCreateParams) => {
            const first = params.messages[0]?.content;
            firstMessageSent = typeof first === "string" ? first : JSON.stringify(first);
            return {
              on() {
                return this;
              },
              finalMessage: async () => {
                throw new Error("network down");
              },
            };
          },
        },
      } as unknown as Anthropic;

      await assert.rejects(
        runTurn(
          "sigue",
          history,
          createGate(async () => "n"),
          MODELS[0],
          createCheckpointStore(),
          createUsageLedger({ persist: false }),
          { client },
        ),
        /network down/,
      );

      assert.match(firstMessageSent, /Resumen corto/);
      assert.deepEqual(history, original);
    });
  });
});
