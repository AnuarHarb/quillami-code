import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { resolveModel } from "../src/models.ts";
import { createClient } from "../src/providers.ts";

describe("providers", () => {
  const previousKey = process.env.MINIMAX_API_KEY;
  const previousBase = process.env.MINIMAX_BASE_URL;

  afterEach(() => {
    restore("MINIMAX_API_KEY", previousKey);
    restore("MINIMAX_BASE_URL", previousBase);
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
