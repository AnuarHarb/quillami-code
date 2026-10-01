import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { cachedMessages, cachedSystem, cachedTools } from "../src/agent/cache.ts";

const ephemeral = { type: "ephemeral" };

describe("prompt cache breakpoints", () => {
  it("marks the system prompt", () => {
    assert.deepEqual(cachedSystem("hola"), [
      { type: "text", text: "hola", cache_control: ephemeral },
    ]);
  });

  it("marks only the last tool without mutating the input", () => {
    const tools: Anthropic.Tool[] = [
      { name: "a", input_schema: { type: "object" } },
      { name: "b", input_schema: { type: "object" } },
    ];
    const out = cachedTools(tools);
    assert.equal(out[0].cache_control, undefined);
    assert.deepEqual(out[1].cache_control, ephemeral);
    assert.equal(tools[1].cache_control, undefined);
  });

  it("marks the last block of the last message and leaves history untouched", () => {
    const history: Anthropic.MessageParam[] = [
      { role: "user", content: "primero" },
      { role: "assistant", content: "ok" },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "uno" },
          { type: "tool_result", tool_use_id: "t2", content: "dos" },
        ],
      },
    ];
    const snapshot = structuredClone(history);
    const out = cachedMessages(history);

    const last = out[2].content as Anthropic.ToolResultBlockParam[];
    assert.equal(last[0].cache_control, undefined);
    assert.deepEqual(last[1].cache_control, ephemeral);
    assert.equal(out[0].content, "primero");
    assert.deepEqual(history, snapshot);
  });

  it("turns a string message into a cached text block", () => {
    const out = cachedMessages([{ role: "user", content: "hola" }]);
    assert.deepEqual(out[0].content, [
      { type: "text", text: "hola", cache_control: ephemeral },
    ]);
  });
});
