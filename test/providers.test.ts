import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { resolveModel } from "../src/models.ts";
import { createClient } from "../src/providers.ts";

type Captured = { url: string; headers: Headers };

async function captureRequest(client: Anthropic): Promise<Captured> {
  let captured: Captured | null = null;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), headers: new Headers(init?.headers) };
    return new Response(
      JSON.stringify({
        id: "m1",
        type: "message",
        role: "assistant",
        model: "x",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  await client
    .withOptions({ fetch: fetchImpl, maxRetries: 0 })
    .messages.create({ model: "x", max_tokens: 1, messages: [{ role: "user", content: "hi" }] });
  assert.ok(captured);
  return captured;
}

describe("providers", () => {
  const saved = Object.fromEntries(
    [
      "MINIMAX_API_KEY",
      "MINIMAX_BASE_URL",
      "OPENROUTER_API_KEY",
      "OPENROUTER_BASE_URL",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
    ].map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) restore(key, value);
  });

  it("sends the OpenRouter key as a bearer token and never the Anthropic key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret";
    delete process.env.OPENROUTER_BASE_URL;
    const request = await captureRequest(createClient(resolveModel("openai/gpt-5.6-sol")!));
    assert.equal(request.url, "https://openrouter.ai/api/v1/messages");
    assert.equal(request.headers.get("authorization"), "Bearer sk-or-test");
    assert.equal(request.headers.get("x-api-key"), null);
    assert.equal(request.headers.get("x-title"), "Quillami Code");
  });

  it("never sends ANTHROPIC_AUTH_TOKEN to MiniMax", async () => {
    process.env.MINIMAX_API_KEY = "sk-mm";
    process.env.ANTHROPIC_AUTH_TOKEN = "anthropic-token";
    const request = await captureRequest(createClient(resolveModel("minimax")!));
    assert.equal(request.headers.get("x-api-key"), "sk-mm");
    assert.equal(request.headers.get("authorization"), null);
  });

  it("respects OPENROUTER_BASE_URL", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_BASE_URL = "https://proxy.example.com/api";
    const client = createClient(resolveModel("openrouter")!);
    assert.equal((client as { baseURL?: string }).baseURL, "https://proxy.example.com/api");
  });

  it("creates MiniMax client with anthropic-compatible base URL", () => {
    process.env.MINIMAX_API_KEY = "sk-test";
    delete process.env.MINIMAX_BASE_URL;
    const model = resolveModel("minimax")!;
    const client = createClient(model);
    assert.equal((client as { baseURL?: string }).baseURL, "https://api.minimax.io/anthropic");
  });

  it("respects MINIMAX_BASE_URL override", () => {
    process.env.MINIMAX_API_KEY = "sk-test";
    process.env.MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";
    const model = resolveModel("minimax")!;
    const client = createClient(model);
    assert.equal((client as { baseURL?: string }).baseURL, "https://api.minimaxi.com/anthropic");
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
