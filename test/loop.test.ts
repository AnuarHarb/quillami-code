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

  it("an interrupt mid-stream keeps the partial reply and the session", async () => {
    await withWorkspace(async () => {
      const controller = new AbortController();
      const client = {
        messages: {
          stream: (_params: unknown, options: { signal: AbortSignal }) => {
            let onText: (delta: string) => void = () => {};
            return {
              on(event: string, callback: (delta: string) => void) {
                if (event === "text") onText = callback;
                return this;
              },
              finalMessage: () =>
                new Promise((_, reject) => {
                  onText("Voy revisando");
                  options.signal.addEventListener("abort", () =>
                    reject(new Error("Request was aborted.")),
                  );
                  setImmediate(() => controller.abort());
                }),
            };
          },
        },
      } as unknown as Anthropic;

      const history: History = [];
      const result = await runTurn(
        "revisa el repo",
        history,
        createGate(async () => "n"),
        MODELS[0],
        createCheckpointStore(),
        createUsageLedger({ persist: false }),
        { client, signal: controller.signal },
      );

      assert.equal(result.interrupted, true);
      assert.deepEqual(history, [
        { role: "user", content: "revisa el repo" },
        {
          role: "assistant",
          content: "Voy revisando\n\n[The user interrupted this turn before it finished.]",
        },
      ]);
    });
  });

  it("an interrupt during tools pairs every tool_use with a result", async () => {
    await withWorkspace(async () => {
      const controller = new AbortController();
      const client = {
        messages: {
          stream: () => ({
            on() {
              return this;
            },
            finalMessage: async () => ({
              content: [
                { type: "tool_use", id: "t1", name: "slow", input: {} },
                { type: "tool_use", id: "t2", name: "slow", input: {} },
              ],
              stop_reason: "tool_use",
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
          }),
        },
      } as unknown as Anthropic;

      let executed = 0;
      const registry = {
        definitions: () => [],
        execute: (_name: string, _input: unknown, ctx?: { signal?: AbortSignal }) => {
          executed += 1;
          return new Promise<string>((_, reject) => {
            ctx?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            controller.abort();
          });
        },
      };

      const history: History = [];
      const result = await runTurn(
        "corre algo",
        history,
        createGate(async () => "n"),
        MODELS[0],
        createCheckpointStore(),
        createUsageLedger({ persist: false }),
        { client, registry, signal: controller.signal },
      );

      assert.equal(result.interrupted, true);
      assert.equal(executed, 1);
      assert.equal(history.length, 4);
      const results = history[2].content as Anthropic.ToolResultBlockParam[];
      assert.deepEqual(
        results.map((block) => [block.tool_use_id, block.content]),
        [
          ["t1", "Not run: the user interrupted the turn."],
          ["t2", "Not run: the user interrupted the turn."],
        ],
      );
      assert.equal(history[3].role, "assistant");
    });
  });

  it("cuts huge tool output before it reaches the model", async () => {
    await withWorkspace(async () => {
      let call = 0;
      let sentToolResult = "";
      const client = {
        messages: {
          stream: (params: Anthropic.MessageCreateParams) => {
            call += 1;
            const last = params.messages.at(-1)?.content;
            if (Array.isArray(last) && last[0]?.type === "tool_result") {
              sentToolResult = String(last[0].content);
            }
            return {
              on() {
                return this;
              },
              finalMessage: async () =>
                call === 1
                  ? {
                      content: [{ type: "tool_use", id: "t1", name: "big", input: {} }],
                      stop_reason: "tool_use",
                      usage: {},
                    }
                  : { content: [{ type: "text", text: "listo" }], stop_reason: "end_turn", usage: {} },
            };
          },
        },
      } as unknown as Anthropic;
      const registry = {
        definitions: () => [],
        execute: async () => "x".repeat(100_000),
      };

      await runTurn(
        "dame todo",
        [],
        createGate(async () => "n"),
        MODELS[0],
        createCheckpointStore(),
        createUsageLedger({ persist: false }),
        { client, registry },
      );

      assert.ok(sentToolResult.length < 31_000);
      assert.match(sentToolResult, /omitted 70000 characters/);
    });
  });

  it("shows the model Jev Router picked and bills the cost OpenRouter reports", async () => {
    await withWorkspace(async () => {
      const client = {
        messages: {
          stream: () => {
            const listeners: Record<string, (value: unknown) => void> = {};
            return {
              on(event: string, callback: (value: unknown) => void) {
                listeners[event] = callback;
                return this;
              },
              finalMessage: async () => {
                listeners.streamEvent?.({
                  type: "message_start",
                  message: { model: "openai/gpt-6.1-sol", usage: {} },
                });
                listeners.streamEvent?.({
                  type: "message_delta",
                  delta: { stop_reason: "end_turn" },
                  usage: { input_tokens: 100, output_tokens: 20, cost: 0.25 },
                });
                return {
                  content: [{ type: "text", text: "listo" }],
                  stop_reason: "end_turn",
                  usage: { input_tokens: 100, output_tokens: 20 },
                };
              },
            };
          },
        },
      } as unknown as Anthropic;

      const router = {
        id: "typesafe/jev-router",
        alias: "auto",
        label: "Auto (Jev Router)",
        provider: "openrouter" as const,
        blurb: "",
        price: { inputPerMillion: 0, outputPerMillion: 0 },
      };
      const usage = createUsageLedger({ persist: false });
      const printed: string[] = [];
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => {
        printed.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      try {
        await runTurn("hola", [], createGate(async () => "n"), router, createCheckpointStore(), usage, {
          client,
        });
      } finally {
        process.stdout.write = write;
      }

      assert.ok(printed.join("").includes("jev · responde con openai/gpt-6.1-sol"));
      assert.match(usage.turnLine(), /\$0\.25 esta sesión/);
    });
  });
});
