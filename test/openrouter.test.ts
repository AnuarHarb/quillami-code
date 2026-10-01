import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resolveModel } from "../src/models.ts";
import {
  catalogPath,
  formatOpenRouterModels,
  isOpenRouterId,
  loadOpenRouterCatalog,
  parseCatalog,
  resetOpenRouterMemory,
  searchOpenRouterModels,
} from "../src/openrouter.ts";
import { costUsd } from "../src/usage.ts";

const SAMPLE = {
  data: [
    {
      id: "qwen/qwen3-coder",
      name: "Qwen: Qwen3 Coder",
      context_length: 262_144,
      created: 1_753_000_000,
      supported_parameters: ["tools", "temperature"],
      pricing: { prompt: "0.0000003", completion: "0.000001", input_cache_read: "0.0000001" },
    },
    {
      id: "qwen/qwen3-coder:batch",
      name: "Qwen3 Coder batch",
      supported_parameters: ["tools"],
      pricing: { prompt: "0.00000015", completion: "0.0000005" },
    },
    {
      id: "google/gemini-3-pro-image-preview",
      name: "Gemini image",
      supported_parameters: ["temperature"],
      pricing: { prompt: "0.000002", completion: "0.000012" },
    },
    { name: "sin id" },
  ],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("openrouter", () => {
  const previousHome = process.env.HOME;
  let home = "";

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "quillami-home-"));
    process.env.HOME = home;
    resetOpenRouterMemory();
  });

  afterEach(async () => {
    process.env.HOME = previousHome;
    resetOpenRouterMemory();
    await rm(home, { recursive: true, force: true });
  });

  it("recognizes vendor/model ids", () => {
    assert.equal(isOpenRouterId("openai/gpt-5.6-sol"), true);
    assert.equal(isOpenRouterId("qwen/qwen3-coder:free"), true);
    assert.equal(isOpenRouterId("~openai/gpt-sol-latest"), true);
    assert.equal(isOpenRouterId("claude-sonnet-5"), false);
    assert.equal(isOpenRouterId("../etc/passwd"), false);
  });

  it("parses prices per million and tool support", () => {
    const models = parseCatalog(SAMPLE);
    assert.equal(models.length, 3);
    assert.deepEqual(models[0], {
      id: "qwen/qwen3-coder",
      name: "Qwen: Qwen3 Coder",
      contextLength: 262_144,
      tools: true,
      created: 1_753_000_000,
      price: {
        inputPerMillion: 0.3,
        outputPerMillion: 1,
        cacheReadPerMillion: 0.1,
        cacheWritePerMillion: undefined,
      },
    });
    assert.equal(models[2].tools, false);
    assert.equal(models[2].created, 0);
  });

  it("labels routers with a -1 list price as variable", () => {
    const [router] = parseCatalog({
      data: [
        {
          id: "typesafe/jev-router",
          name: "TypeSafe: Jev Router",
          supported_parameters: ["tools"],
          pricing: { prompt: "-1", completion: "-1" },
        },
      ],
    });
    assert.equal(router.variablePrice, true);
    assert.match(formatOpenRouterModels([router]), /precio variable/);
    assert.equal(parseCatalog(SAMPLE)[0].variablePrice, undefined);
  });

  it("searches only models with tools and skips batch variants", () => {
    const models = parseCatalog(SAMPLE);
    assert.deepEqual(
      searchOpenRouterModels(models, "qwen coder").map((model) => model.id),
      ["qwen/qwen3-coder"],
    );
    assert.deepEqual(searchOpenRouterModels(models, "gemini"), []);
    assert.match(formatOpenRouterModels(models.slice(0, 1)), /qwen\/qwen3-coder {2}\$0\.30 \/ \$1\.00 por M · 262k ctx/);
  });

  it("caches the catalog for a day and falls back to a stale copy offline", async () => {
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return jsonResponse(SAMPLE);
    }) as typeof fetch;

    const first = await loadOpenRouterCatalog({ fetchImpl, now: () => 1_000 });
    assert.equal(first?.length, 3);
    assert.ok(existsSync(catalogPath()));

    await loadOpenRouterCatalog({ fetchImpl, now: () => 2_000 });
    assert.equal(fetches, 1);

    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const stale = await loadOpenRouterCatalog({ fetchImpl: offline, now: () => 1_000 + 2 * 86_400_000 });
    assert.equal(stale?.length, 3);
  });

  it("returns null without network or cache", async () => {
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    assert.equal(await loadOpenRouterCatalog({ fetchImpl: offline }), null);
  });

  it("resolves OpenRouter ids with catalog pricing and real cache prices", async () => {
    await loadOpenRouterCatalog({ fetchImpl: (async () => jsonResponse(SAMPLE)) as typeof fetch });

    const model = resolveModel("qwen/qwen3-coder");
    assert.equal(model?.provider, "openrouter");
    assert.equal(model?.label, "Qwen: Qwen3 Coder");
    assert.equal(model?.price.inputPerMillion, 0.3);

    const usd = costUsd("qwen/qwen3-coder", {
      input: 0,
      output: 0,
      cacheRead: 1_000_000,
      cacheWrite: 0,
    });
    assert.ok(Math.abs(usd - 0.1) < 1e-9);
  });

  it("the openrouter alias points at Sonnet 5 on OpenRouter", () => {
    const model = resolveModel("openrouter");
    assert.equal(model?.id, "anthropic/claude-sonnet-5");
    assert.equal(model?.provider, "openrouter");
    assert.equal(model?.alias, "openrouter");
  });
});
