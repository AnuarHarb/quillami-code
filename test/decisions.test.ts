import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRiskPolicy,
  AUTO_CACHE_TTL_MS,
  complexityTier,
  formatAutoPick,
  looksLikeSecret,
  matchesDenylist,
  pickModelForComplexity,
  shouldProposeAutoMemory,
  stickToPrevious,
  type AutoPick,
} from "../src/decisions.ts";
import type { ModelChoice } from "../src/models.ts";

describe("decisions risk policy", () => {
  const workspace = "/tmp/ws";
  const base = { tool: "bash", command: "ls", workspace };

  it("auto-approves low-risk bash with high confidence", () => {
    const result = applyRiskPolicy("bash", base, { score: 0.2, confidence: 0.9 });
    assert.equal(result.action, "allow");
  });

  it("blocks high-risk bash", () => {
    const result = applyRiskPolicy("bash", base, { score: 2.8, confidence: 0.9 });
    assert.equal(result.action, "deny");
  });

  it("forces ask at level 2+ even with low denylist overlap", () => {
    const result = applyRiskPolicy("bash", base, { score: 2.1, confidence: 0.7 });
    assert.equal(result.action, "ask");
    if (result.action === "ask") assert.equal(result.forceAsk, true);
  });

  it("denylist prevents auto-approve", () => {
    const input = { ...base, command: "git push origin main" };
    assert.equal(matchesDenylist(input), true);
    const result = applyRiskPolicy("bash", input, { score: 0.1, confidence: 0.95 });
    assert.equal(result.action, "ask");
    if (result.action === "ask") assert.equal(result.forceAsk, true);
  });

  it("null jev falls back to ask", () => {
    const result = applyRiskPolicy("bash", base, null);
    assert.equal(result.action, "ask");
  });

  it("write never auto-approves", () => {
    const result = applyRiskPolicy(
      "write",
      { tool: "write", path: "a.ts", workspace },
      { score: 0, confidence: 1 },
    );
    assert.equal(result.action, "ask");
  });
});

describe("decisions router", () => {
  it("falls back to sonnet on low confidence", () => {
    const picked = pickModelForComplexity({
      type: "score",
      score: 0.1,
      confidence: 0.3,
      legend: {} as never,
      probabilities: {} as never,
    });
    assert.equal(picked.model.alias, "sonnet-4.5");
  });

  it("maps trivial to haiku", () => {
    const picked = pickModelForComplexity({
      type: "score",
      score: 0.2,
      confidence: 0.9,
      legend: {} as never,
      probabilities: {} as never,
    });
    assert.equal(picked.model.alias, "haiku");
  });

  it("routes the same tiers through OpenRouter", () => {
    const answer = (score: number) => ({
      type: "score" as const,
      score,
      confidence: 0.9,
      legend: {} as never,
      probabilities: {} as never,
    });
    assert.equal(pickModelForComplexity(answer(0.2), "openrouter").model.id, "deepseek/deepseek-v4.1-flash");
    assert.equal(pickModelForComplexity(answer(1), "openrouter").model.id, "xiaomi/mimo-v2.6-pro");
    assert.equal(pickModelForComplexity(answer(2), "openrouter").model.id, "anthropic/claude-sonnet-5.5");
    assert.equal(pickModelForComplexity(answer(2), "openrouter").model.provider, "openrouter");
    assert.equal(pickModelForComplexity(answer(2.8), "openrouter").model.id, "anthropic/claude-opus-5.5");
  });

  it("only reaches the top tier with a high score and a clear signal", () => {
    const answer = (score: number, confidence: number) => ({
      type: "score" as const,
      score,
      confidence,
      legend: {} as never,
      probabilities: {} as never,
    });
    assert.deepEqual(complexityTier(answer(2.8, 0.9)), { tier: "max", difficulty: "muy difícil" });
    assert.deepEqual(complexityTier(answer(2.4, 0.95)), { tier: "heavy", difficulty: "difícil" });
    assert.deepEqual(complexityTier(answer(2.8, 0.7)), { tier: "heavy", difficulty: "difícil" });
  });
});

describe("decisions sticky auto", () => {
  const model = (id: string, input: number, output: number, cacheRead?: number): ModelChoice => ({
    id,
    alias: id,
    label: id,
    provider: "openrouter",
    blurb: "",
    price: { inputPerMillion: input, outputPerMillion: output, cacheReadPerMillion: cacheRead },
  });
  const sonnet: AutoPick = { model: model("sonnet", 2, 10, 0.2), tier: "heavy", difficulty: "difícil" };
  const flash: AutoPick = { model: model("flash", 0.03, 0.5), tier: "light", difficulty: "trivial" };
  const pricey: AutoPick = { model: model("mid", 1.5, 6), tier: "light", difficulty: "trivial" };
  const opus: AutoPick = { model: model("opus", 4, 20), tier: "heavy", difficulty: "difícil" };
  const now = 1_000_000;

  it("keeps the cached model when switching down would cost more", () => {
    const kept = stickToPrevious({ pick: sonnet, at: now - 1000 }, pricey, { tokens: 50_000, now });
    assert.equal(kept.model.id, "sonnet");
    assert.equal(kept.kept, true);
    assert.equal(kept.difficulty, "trivial");
    assert.equal(formatAutoPick(kept), "· jev · trivial → sigue con sonnet (su caché sale más barato)");
  });

  it("switches down when the new model is cheaper even without cache", () => {
    const next = stickToPrevious({ pick: sonnet, at: now - 1000 }, flash, { tokens: 50_000, now });
    assert.equal(next.model.id, "flash");
    assert.equal(next.kept, undefined);
  });

  it("always switches when the message is harder or the cache expired", () => {
    const easy: AutoPick = { ...pricey, model: model("cheap", 0.01, 0.01, 0.001) };
    assert.equal(stickToPrevious({ pick: easy, at: now - 1000 }, opus, { tokens: 50_000, now }).model.id, "opus");
    const stale = now - AUTO_CACHE_TTL_MS - 1;
    assert.equal(stickToPrevious({ pick: sonnet, at: stale }, pricey, { tokens: 50_000, now }).model.id, "mid");
    assert.equal(stickToPrevious(null, pricey, { tokens: 50_000, now }).model.id, "mid");
  });
});

describe("decisions memory", () => {
  it("detects common secret patterns", () => {
    assert.equal(looksLikeSecret("key sk-abcdefghijklmnopqrstuvwxyz123456"), true);
    assert.equal(looksLikeSecret("prefiero respuestas cortas"), false);
  });

  it("proposes user memory when fact noul is high", () => {
    const proposal = shouldProposeAutoMemory(
      { user_fact: 0.9, behavior_pref: 0.1, has_secret: 0.1 },
      "Soy backend en Go y uso Postgres",
    );
    assert.deepEqual(proposal, { propose: true, target: "user" });
  });
});
