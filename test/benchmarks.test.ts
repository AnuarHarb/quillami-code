import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BENCHMARK_SNAPSHOT } from "../src/benchmarkSnapshot.ts";
import {
  autoVendors,
  benchmarkIndex,
  benchmarksEnabled,
  benchmarksPath,
  buildBenchmarkPool,
  loadBenchmarks,
  matchBenchmark,
  parseBenchmarks,
  pickByBenchmark,
  type BenchmarkModel,
} from "../src/benchmarks.ts";
import { formatAutoPick, pickModelByBenchmark } from "../src/decisions.ts";
import { resolveModel } from "../src/models.ts";
import type { OpenRouterModel } from "../src/openrouter.ts";

function aaEntry(slug: string, intelligence: number | null) {
  return {
    slug,
    name: slug,
    evaluations: { artificial_analysis_intelligence_index: intelligence },
  };
}

function orModel(id: string, input: number, output: number, extra: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id,
    name: id,
    contextLength: 200_000,
    tools: true,
    created: 0,
    price: { inputPerMillion: input, outputPerMillion: output },
    ...extra,
  };
}

const BENCHMARKS: BenchmarkModel[] = [
  { slug: "claude-opus-5-5", name: "Claude Opus 5.5", intelligence: 57.6 },
  { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", intelligence: 56 },
  { slug: "gpt-6-1-sol", name: "GPT-6.1 Sol", intelligence: 51.8 },
  { slug: "mimo-v2-6-pro", name: "MiMo Pro", intelligence: 46.3 },
  { slug: "deepseek-v4-1-flash", name: "DeepSeek Flash", intelligence: 39.5 },
  { slug: "grok-4-6-medium", name: "Grok 4.6", intelligence: 44.3 },
  { slug: "claude-4-5-haiku", name: "Claude 4.5 Haiku", intelligence: 15.4 },
  { slug: "tiny-model", name: "Tiny", intelligence: 10 },
];

const DAY = 24 * 60 * 60 * 1000;
const failing = (async () => new Response("nope", { status: 500 })) as typeof fetch;

const CATALOG: OpenRouterModel[] = [
  orModel("anthropic/claude-opus-5.5", 4, 20),
  orModel("anthropic/claude-sonnet-5.5", 2, 10),
  orModel("openai/gpt-6.1-sol", 2, 10),
  orModel("xiaomi/mimo-v2.6-pro", 0.435, 0.87),
  orModel("deepseek/deepseek-v4.1-flash", 0.03, 0.5),
  orModel("vendor/tiny-model", 0.01, 0.01),
  orModel("anthropic/claude-sonnet-5.5:batch", 1, 5),
  orModel("~anthropic/claude-sonnet-latest", 2, 10),
  orModel("openrouter/auto", 0, 0, { variablePrice: true }),
  orModel("vendor/short-context", 0.01, 0.01, { contextLength: 32_000 }),
  orModel("vendor/no-tools", 0.01, 0.01, { tools: false }),
];

describe("benchmarks", () => {
  const previousHome = process.env.HOME;
  const previousAa = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const previousOr = process.env.OPENROUTER_API_KEY;
  let home = "";

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "quillami-home-"));
    process.env.HOME = home;
    process.env.ARTIFICIAL_ANALYSIS_API_KEY = "aa-test";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
  });

  afterEach(async () => {
    process.env.HOME = previousHome;
    for (const [name, value] of [
      ["ARTIFICIAL_ANALYSIS_API_KEY", previousAa],
      ["OPENROUTER_API_KEY", previousOr],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(home, { recursive: true, force: true });
  });

  it("needs both the Artificial Analysis and the OpenRouter key", () => {
    assert.equal(benchmarksEnabled(), true);
    delete process.env.OPENROUTER_API_KEY;
    assert.equal(benchmarksEnabled(), false);
  });

  it("keeps only entries with an intelligence index", () => {
    const parsed = parseBenchmarks({ data: [aaEntry("a", 40), aaEntry("b", null), { name: "sin slug" }] });
    assert.deepEqual(parsed.map((model) => model.slug), ["a"]);
  });

  it("matches OpenRouter ids to benchmark slugs", () => {
    const index = benchmarkIndex(BENCHMARKS);
    assert.equal(matchBenchmark("openai/gpt-6.1-sol", index)?.slug, "gpt-6-1-sol");
    assert.equal(matchBenchmark("x-ai/grok-4.6", index)?.slug, "grok-4-6-medium");
    assert.equal(matchBenchmark("anthropic/claude-haiku-4.5", index)?.slug, "claude-4-5-haiku");
    assert.equal(matchBenchmark("vendor/unknown", index), undefined);
  });

  it("pools concrete priced models with tools and long context", () => {
    const ids = buildBenchmarkPool(CATALOG, BENCHMARKS).map((entry) => entry.model.id);
    assert.deepEqual(ids, [
      "anthropic/claude-opus-5.5",
      "anthropic/claude-sonnet-5.5",
      "openai/gpt-6.1-sol",
      "xiaomi/mimo-v2.6-pro",
      "deepseek/deepseek-v4.1-flash",
      "vendor/tiny-model",
    ]);
  });

  it("picks the cheapest model that clears each tier's bar", () => {
    const pool = buildBenchmarkPool(CATALOG, BENCHMARKS);
    assert.equal(pickByBenchmark(pool, "light")?.candidate.model.id, "deepseek/deepseek-v4.1-flash");
    assert.equal(pickByBenchmark(pool, "standard")?.candidate.model.id, "xiaomi/mimo-v2.6-pro");
    assert.equal(pickByBenchmark(pool, "heavy")?.candidate.model.id, "anthropic/claude-sonnet-5.5");
    assert.equal(pickByBenchmark([], "heavy"), null);
  });

  it("turns the pick into an OpenRouter model and a short line", () => {
    const pool = buildBenchmarkPool(CATALOG, BENCHMARKS);
    const picked = pickModelByBenchmark("heavy", "difícil", pool);
    assert.equal(picked?.model.id, "anthropic/claude-sonnet-5.5");
    assert.equal(picked?.model.provider, "openrouter");
    assert.equal(picked?.benchmark?.intelligence, 56);
    assert.equal(formatAutoPick(picked!), "· jev · difícil → anthropic/claude-sonnet-5.5 · $2.00 / $10.00 por M");
  });

  it("limits the pool to QUILLAMI_AUTO_VENDORS", () => {
    process.env.QUILLAMI_AUTO_VENDORS = "anthropic, OpenAI";
    try {
      const ids = buildBenchmarkPool(CATALOG, BENCHMARKS, autoVendors()).map((entry) => entry.model.id);
      assert.deepEqual(ids, ["anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol"]);
    } finally {
      delete process.env.QUILLAMI_AUTO_VENDORS;
    }
  });

  it("routes auto through OpenRouter when benchmarks are on", () => {
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      assert.equal(resolveModel("auto")?.provider, "openrouter");
      assert.match(resolveModel("auto")?.blurb ?? "", /benchmarks/);
    } finally {
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    }
  });

  it("fetches every page once and then serves the cache", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string | URL) => {
      calls += 1;
      const page = Number(new URL(String(url)).searchParams.get("page"));
      const body =
        page === 1
          ? { pagination: { has_more: true }, data: [aaEntry("a", 40)] }
          : { pagination: { has_more: false }, data: [aaEntry("b", 50)] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

    const first = await loadBenchmarks({ fetchImpl });
    assert.deepEqual(first?.map((model) => model.slug), ["a", "b"]);
    assert.equal(calls, 2);
    assert.equal(existsSync(benchmarksPath()), true);

    const second = await loadBenchmarks({ fetchImpl });
    assert.deepEqual(second?.map((model) => model.slug), ["a", "b"]);
    assert.equal(calls, 2);
  });

  it("falls back to a stale cache newer than the snapshot when a refresh fails", async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ data: [aaEntry("a", 40)] }), { status: 200 })) as typeof fetch;
    const cachedAt = BENCHMARK_SNAPSHOT.fetchedAt + 1;
    await loadBenchmarks({ fetchImpl: ok, now: () => cachedAt });
    const stale = await loadBenchmarks({ fetchImpl: failing, now: () => cachedAt + 2 * DAY });
    assert.deepEqual(stale?.map((model) => model.slug), ["a"]);
  });

  it("falls back to the bundled snapshot without a cache", async () => {
    const models = await loadBenchmarks({ fetchImpl: failing });
    assert.equal(models, BENCHMARK_SNAPSHOT.models);
  });

  it("prefers the snapshot over a cache older than it", async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ data: [aaEntry("a", 40)] }), { status: 200 })) as typeof fetch;
    await loadBenchmarks({ fetchImpl: ok, now: () => 0 });
    const models = await loadBenchmarks({ fetchImpl: failing, now: () => BENCHMARK_SNAPSHOT.fetchedAt + 2 * DAY });
    assert.equal(models, BENCHMARK_SNAPSHOT.models);
  });

  it("keeps fetched benchmarks when the cache can't be written", async () => {
    await writeFile(path.join(home, ".quillami"), "not a directory");
    const ok = (async () =>
      new Response(JSON.stringify({ data: [aaEntry("a", 40)] }), { status: 200 })) as typeof fetch;
    const models = await loadBenchmarks({ fetchImpl: ok });
    assert.deepEqual(models?.map((model) => model.slug), ["a"]);
  });

  it("ships a snapshot that maps onto OpenRouter ids", () => {
    const slugs = BENCHMARK_SNAPSHOT.models.map((model) => model.slug);
    assert.ok(slugs.length > 0);
    assert.equal(new Set(slugs).size, slugs.length);
    assert.ok(buildBenchmarkPool(CATALOG, BENCHMARK_SNAPSHOT.models).length > 0);
  });
});
