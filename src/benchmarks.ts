import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BENCHMARK_SNAPSHOT } from "./benchmarkSnapshot.js";
import { configDir } from "./config.js";
import type { OpenRouterModel } from "./openrouter.js";

export const AA_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
/** Free tier allows 100 requests a day; a refresh costs one per page (~4). */
const BENCHMARKS_TTL_MS = 24 * 60 * 60 * 1000;
const BENCHMARKS_TIMEOUT_MS = 8000;
const MAX_PAGES = 10;
const MIN_CONTEXT = 128_000;

export const BENCHMARK_ATTRIBUTION = "benchmarks: Artificial Analysis (artificialanalysis.ai)";

export type BenchmarkTier = "light" | "standard" | "heavy";

/** Minimum intelligence index per tier, as a fraction of the best model in the pool. */
export const BENCHMARK_BARS: Record<BenchmarkTier, number> = {
  light: 0.6,
  standard: 0.8,
  heavy: 0.95,
};

export type BenchmarkModel = { slug: string; name: string; intelligence: number };

export type BenchmarkCandidate = {
  model: OpenRouterModel;
  slug: string;
  intelligence: number;
  /** USD per million tokens, 3 input : 1 output. */
  blendedPrice: number;
};

type BenchmarksFile = { fetchedAt: number; models: BenchmarkModel[] };

const EFFORT_SUFFIXES = [
  "",
  "-medium",
  "-high",
  "-non-reasoning",
  "-low",
  "-xhigh",
  "-reasoning",
  "-thinking",
  "-max",
  "-minimal",
];

export function benchmarksPath(): string {
  return path.join(configDir(), "artificial-analysis.json");
}

/** Benchmark routing picks among OpenRouter models, so it needs both keys. */
export function benchmarksEnabled(): boolean {
  return Boolean(
    process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim() && process.env.OPENROUTER_API_KEY?.trim(),
  );
}

/**
 * Fresh cache wins. When the API can't be reached, the newer of the stale
 * cache and the bundled snapshot is used.
 */
export async function loadBenchmarks(options?: {
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<BenchmarkModel[] | null> {
  const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim();
  const now = options?.now ?? Date.now;
  const cached = readBenchmarksFile();
  if (cached && !options?.force && now() - cached.fetchedAt < BENCHMARKS_TTL_MS) {
    return cached.models;
  }
  const fallback = cached && cached.fetchedAt > BENCHMARK_SNAPSHOT.fetchedAt ? cached : BENCHMARK_SNAPSHOT;
  if (!key) return fallback.models;

  let models: BenchmarkModel[];
  try {
    models = await fetchBenchmarks(key, options?.fetchImpl);
  } catch {
    return fallback.models;
  }
  try {
    writeBenchmarksFile({ fetchedAt: now(), models });
  } catch {
    // An unwritable cache only costs a refetch next time.
  }
  return models;
}

export async function fetchBenchmarks(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BenchmarkModel[]> {
  const models: BenchmarkModel[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchImpl(`${AA_URL}?page=${page}`, {
      signal: AbortSignal.timeout(BENCHMARKS_TIMEOUT_MS),
      headers: { Accept: "application/json", "x-api-key": key },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = (await response.json()) as { pagination?: { has_more?: boolean } };
    models.push(...parseBenchmarks(json));
    if (!json.pagination?.has_more) break;
  }
  if (models.length === 0) throw new Error("no benchmarks");
  return models;
}

export function parseBenchmarks(json: unknown): BenchmarkModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const models: BenchmarkModel[] = [];
  for (const raw of data) {
    const entry = raw as {
      slug?: unknown;
      name?: unknown;
      evaluations?: { artificial_analysis_intelligence_index?: unknown };
    };
    const intelligence = entry?.evaluations?.artificial_analysis_intelligence_index;
    if (typeof entry?.slug !== "string" || typeof intelligence !== "number") continue;
    models.push({
      slug: entry.slug,
      name: typeof entry.name === "string" ? entry.name : entry.slug,
      intelligence,
    });
  }
  return models;
}

/**
 * Artificial Analysis slugs use dashes (`gpt-6-1-sol`) and list one entry per
 * reasoning effort; OpenRouter ids use dots (`openai/gpt-6.1-sol`).
 */
export function benchmarkIndex(models: BenchmarkModel[]): Map<string, BenchmarkModel> {
  const index = new Map<string, BenchmarkModel>();
  for (const model of models) {
    index.set(model.slug, model);
    const claude = model.slug.match(/^claude-(\d+(?:-\d+)?)-(haiku|sonnet|opus)(.*)$/);
    if (claude) index.set(`claude-${claude[2]}-${claude[1]}${claude[3]}`, model);
  }
  return index;
}

export function matchBenchmark(
  openRouterId: string,
  index: Map<string, BenchmarkModel>,
): BenchmarkModel | undefined {
  const name = openRouterId.split("/")[1];
  if (!name) return undefined;
  const slug = name.toLowerCase().replace(/[._]/g, "-").replace(/-+/g, "-");
  for (const suffix of EFFORT_SUFFIXES) {
    const hit = index.get(slug + suffix);
    if (hit) return hit;
  }
  return undefined;
}

/** `QUILLAMI_AUTO_VENDORS=anthropic,openai` limits auto to those OpenRouter vendors; empty means all. */
export function autoVendors(): string[] {
  return (process.env.QUILLAMI_AUTO_VENDORS ?? "")
    .split(/[\s,]+/)
    .map((vendor) => vendor.trim().toLowerCase())
    .filter(Boolean);
}

/** Concrete, priced OpenRouter models with tools and a long context that have a benchmark. */
export function buildBenchmarkPool(
  catalog: OpenRouterModel[],
  benchmarks: BenchmarkModel[],
  vendors: string[] = [],
): BenchmarkCandidate[] {
  const index = benchmarkIndex(benchmarks);
  const pool: BenchmarkCandidate[] = [];
  for (const model of catalog) {
    if (!model.tools || model.variablePrice) continue;
    if (model.id.startsWith("~") || model.id.includes(":") || model.id.startsWith("openrouter/")) continue;
    if (vendors.length > 0 && !vendors.includes(model.id.split("/")[0].toLowerCase())) continue;
    if (model.price.inputPerMillion <= 0 || model.contextLength < MIN_CONTEXT) continue;
    const benchmark = matchBenchmark(model.id, index);
    if (!benchmark) continue;
    pool.push({
      model,
      slug: benchmark.slug,
      intelligence: benchmark.intelligence,
      blendedPrice: (3 * model.price.inputPerMillion + model.price.outputPerMillion) / 4,
    });
  }
  return pool;
}

/** Cheapest candidate that clears the tier's bar; ties go to the smarter one. */
export function pickByBenchmark(
  pool: BenchmarkCandidate[],
  tier: BenchmarkTier,
): { candidate: BenchmarkCandidate; bar: number } | null {
  if (pool.length === 0) return null;
  const best = Math.max(...pool.map((candidate) => candidate.intelligence));
  const bar = best * BENCHMARK_BARS[tier];
  const [candidate] = pool
    .filter((entry) => entry.intelligence >= bar)
    .sort((a, b) => a.blendedPrice - b.blendedPrice || b.intelligence - a.intelligence);
  return candidate ? { candidate, bar } : null;
}

function readBenchmarksFile(): BenchmarksFile | null {
  const file = benchmarksPath();
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as BenchmarksFile;
    return typeof parsed.fetchedAt === "number" && Array.isArray(parsed.models) ? parsed : null;
  } catch {
    return null;
  }
}

function writeBenchmarksFile(data: BenchmarksFile): void {
  const file = benchmarksPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, file);
}
