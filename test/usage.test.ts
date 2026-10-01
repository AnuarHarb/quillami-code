import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTokenCount, formatUsd, estimateTokens } from "../src/tokens.ts";
import { costUsd, createUsageLedger, readApiUsage, reportedCostUsd } from "../src/usage.ts";

describe("usage", () => {
  it("estimates tokens from characters, not words", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("a".repeat(80_000)), 20_000);
  });

  it("reads API usage and accumulates spend", () => {
    const ledger = createUsageLedger({ persist: false });
    ledger.beginTurn();
    ledger.record("claude-haiku-4-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });

    assert.deepEqual(
      readApiUsage({ input_tokens: 10, output_tokens: 5 }),
      { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    );
    assert.match(ledger.turnLine(), /1\.00M in/);
    assert.match(ledger.turnLine(), /\$6\.00 esta sesión/);
  });

  it("bills cache writes at 1.25x and cache reads at 0.1x input", () => {
    const usd = costUsd("claude-haiku-4-5", {
      input: 0,
      output: 0,
      cacheWrite: 1_000_000,
      cacheRead: 1_000_000,
    });
    assert.ok(Math.abs(usd - 1.35) < 1e-9);
  });

  it("counts cached tokens in the prompt size and shows the cache share", () => {
    const ledger = createUsageLedger({ persist: false });
    ledger.beginTurn();
    ledger.record("claude-haiku-4-5", {
      input_tokens: 1_000,
      cache_read_input_tokens: 9_000,
      output_tokens: 100,
    });
    assert.match(ledger.turnLine(), /10k in \(90% de caché\)/);
  });

  it("bills the cost OpenRouter reports instead of estimating", () => {
    const ledger = createUsageLedger({ persist: false });
    ledger.beginTurn();
    ledger.record("typesafe/jev-router", { input_tokens: 100, output_tokens: 10, cost: 0.42 });
    assert.match(ledger.turnLine(), /\$0\.42 esta sesión/);
    assert.equal(reportedCostUsd({ cost: -1 }), undefined);
    assert.equal(reportedCostUsd({ input_tokens: 1 }), undefined);
  });

  it("reports what auto picked and how it compares with Sonnet", () => {
    const ledger = createUsageLedger({ persist: false });
    const baseline = { model: "claude-sonnet-4-5", label: "Sonnet 4.5" };
    ledger.setAutoRoute({ label: "DeepSeek Flash", detail: "índice 39.5", baseline });
    ledger.beginTurn();
    ledger.record("deepseek/deepseek-flash", { input_tokens: 1_000_000, output_tokens: 0, cost: 0.03 });
    ledger.setAutoRoute({ label: "DeepSeek Flash", detail: "índice 39.5", baseline });
    ledger.beginTurn();
    ledger.record("deepseek/deepseek-flash", { input_tokens: 1_000_000, output_tokens: 0, cost: 0.03 });
    ledger.setAutoRoute(null);
    ledger.beginTurn();
    ledger.record("claude-haiku-4-5", { input_tokens: 1_000_000, output_tokens: 0 });

    const report = ledger.report();
    assert.match(report, /auto\s+DeepSeek Flash ×2 \(índice 39\.5\)/);
    assert.match(report, /\$0\.06 vs \$6\.00 con Sonnet 4\.5 siempre \(ahorro 99%\)/);
    assert.match(report, /benchmarks: Artificial Analysis/);
  });

  it("has no auto section without auto turns", () => {
    const ledger = createUsageLedger({ persist: false });
    ledger.beginTurn();
    ledger.record("claude-haiku-4-5", { input_tokens: 10, output_tokens: 1 });
    assert.doesNotMatch(ledger.report(), /auto/);
  });

  it("formats token and dollar amounts", () => {
    assert.equal(formatTokenCount(340), "340");
    assert.equal(formatTokenCount(12400), "12.4k");
    assert.equal(formatTokenCount(1_000_000), "1.00M");
    assert.equal(formatUsd(0.0023), "$0.0023");
    assert.equal(formatUsd(1.2), "$1.20");
  });
});
