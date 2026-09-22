import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_MODEL_ID,
  defaultModel,
  resolveModel,
} from "../src/models.ts";

describe("models", () => {
  const previousQuillami = process.env.QUILLAMI_MODEL;
  const previousKillami = process.env.KILLAMI_MODEL;
  const previousAnthropic = process.env.ANTHROPIC_MODEL;
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousMinimaxKey = process.env.MINIMAX_API_KEY;

  afterEach(() => {
    restore("QUILLAMI_MODEL", previousQuillami);
    restore("KILLAMI_MODEL", previousKillami);
    restore("ANTHROPIC_MODEL", previousAnthropic);
    restore("ANTHROPIC_API_KEY", previousAnthropicKey);
    restore("MINIMAX_API_KEY", previousMinimaxKey);
  });

  it("resolves aliases, labels, and raw Claude ids", () => {
    assert.equal(resolveModel("fable")?.id, "claude-fable-5-1");
    assert.equal(resolveModel("minimax")?.id, "MiniMax-M3");
    assert.equal(resolveModel("Sonnet 5")?.id, "claude-sonnet-5");
    assert.equal(resolveModel("claude-haiku-4-5")?.id, "claude-haiku-4-5");
    assert.equal(resolveModel("claude-nuevo-experimental")?.id, "claude-nuevo-experimental");
    assert.equal(resolveModel("MiniMax-M2.5")?.id, "MiniMax-M2.5");
    assert.equal(resolveModel("MiniMax-M2.5")?.provider, "minimax");
    assert.equal(resolveModel("gpt-5"), null);
    assert.equal(resolveModel(""), null);
  });

  it("picks env overrides and falls back to Sonnet 4.5", () => {
    delete process.env.QUILLAMI_MODEL;
    delete process.env.KILLAMI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    assert.equal(defaultModel().id, DEFAULT_MODEL_ID);

    process.env.ANTHROPIC_MODEL = "opus";
    assert.equal(defaultModel().id, "claude-opus-5");

    process.env.QUILLAMI_MODEL = "haiku";
    assert.equal(defaultModel().id, "claude-haiku-4-5");
  });

  it("defaults to MiniMax when only MINIMAX_API_KEY is set", () => {
    delete process.env.QUILLAMI_MODEL;
    delete process.env.KILLAMI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MINIMAX_API_KEY = "sk-mm";
    assert.equal(defaultModel().id, "MiniMax-M3");
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
