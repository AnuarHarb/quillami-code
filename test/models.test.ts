import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  autoTiers,
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
    assert.equal(resolveModel("openai/gpt-5.6-sol")?.provider, "openrouter");
    assert.equal(resolveModel("minimax/minimax-m3")?.provider, "openrouter");
  });

  it("defaults to OpenRouter when it is the only provider key", () => {
    const previousOpenRouter = process.env.OPENROUTER_API_KEY;
    delete process.env.QUILLAMI_MODEL;
    delete process.env.KILLAMI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    try {
      assert.equal(defaultModel().provider, "openrouter");
    } finally {
      restore("OPENROUTER_API_KEY", previousOpenRouter);
    }
  });

  it("defaults to auto when there is a Jev key and no saved model", () => {
    const previousTypesafe = process.env.TYPESAFE_API_KEY;
    delete process.env.QUILLAMI_MODEL;
    delete process.env.KILLAMI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.TYPESAFE_API_KEY = "ts-test";
    try {
      assert.equal(defaultModel().id, "auto");
      process.env.QUILLAMI_MODEL = "haiku";
      assert.equal(defaultModel().id, "claude-haiku-4-5");
    } finally {
      restore("TYPESAFE_API_KEY", previousTypesafe);
    }
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

  it("routes auto through Claude directly, or through OpenRouter without an Anthropic key", () => {
    const previousOpenRouter = process.env.OPENROUTER_API_KEY;
    const previousBenchmarks = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
      assert.equal(resolveModel("auto"), null);

      process.env.OPENROUTER_API_KEY = "sk-or-test";
      assert.equal(resolveModel("auto")?.id, "auto");
      assert.equal(resolveModel("auto")?.provider, "openrouter");
      assert.deepEqual(
        Object.values(autoTiers("openrouter")).map((model) => model.id),
        ["~anthropic/claude-haiku-latest", "~anthropic/claude-sonnet-latest", "~anthropic/claude-opus-latest"],
      );

      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      assert.equal(resolveModel("auto")?.provider, "anthropic");
      assert.deepEqual(
        Object.values(autoTiers("anthropic")).map((model) => model.alias),
        ["haiku", "sonnet-4.5", "opus"],
      );
    } finally {
      restore("OPENROUTER_API_KEY", previousOpenRouter);
      restore("ARTIFICIAL_ANALYSIS_API_KEY", previousBenchmarks);
    }
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
