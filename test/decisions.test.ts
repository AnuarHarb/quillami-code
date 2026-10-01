import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRiskPolicy,
  looksLikeSecret,
  matchesDenylist,
  pickModelForComplexity,
  shouldProposeAutoMemory,
} from "../src/decisions.ts";

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
