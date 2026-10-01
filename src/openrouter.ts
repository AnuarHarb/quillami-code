import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configDir } from "./config.js";
import type { ModelPrice } from "./models.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
export const OPENROUTER_DEFAULT_ID = "anthropic/claude-sonnet-5";
/** TypeSafe's router on OpenRouter: picks model and reasoning effort per request. */
export const JEV_ROUTER_ID = "typesafe/jev-router";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 8000;

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number;
  tools: boolean;
  /** Unix seconds; 0 when the catalog does not say. */
  created: number;
  price: ModelPrice;
  /** Routers list a price of -1: it depends on the model they pick. */
  variablePrice?: boolean;
};

type CatalogFile = { fetchedAt: number; models: OpenRouterModel[] };

let memory: Map<string, OpenRouterModel> | null = null;

export function catalogPath(): string {
  return path.join(configDir(), "openrouter-models.json");
}

/** Model ids with a slash (vendor/model) are OpenRouter ids; a leading ~ marks a "latest" alias. */
export function isOpenRouterId(id: string): boolean {
  return /^~?[a-z0-9][\w.-]*\/[\w.:-]+$/i.test(id.trim());
}

export function cachedOpenRouterModel(id: string): OpenRouterModel | undefined {
  if (!memory) {
    const file = readCatalogFile();
    memory = new Map((file?.models ?? []).map((model) => [model.id, model]));
  }
  return memory.get(id);
}

/**
 * Fresh cache wins; otherwise fetch the public catalog (no key needed). When
 * the fetch fails, a stale cache is better than nothing.
 */
export async function loadOpenRouterCatalog(options?: {
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<OpenRouterModel[] | null> {
  const now = options?.now ?? Date.now;
  const cached = readCatalogFile();
  if (cached && !options?.force && now() - cached.fetchedAt < CATALOG_TTL_MS) {
    remember(cached.models);
    return cached.models;
  }

  let models: OpenRouterModel[];
  try {
    const response = await (options?.fetchImpl ?? fetch)(CATALOG_URL, {
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    models = parseCatalog(await response.json());
    if (models.length === 0) throw new Error("empty catalog");
  } catch {
    if (cached) remember(cached.models);
    return cached?.models ?? null;
  }
  try {
    writeCatalogFile({ fetchedAt: now(), models });
  } catch {
    // An unwritable cache only costs a refetch next time.
  }
  remember(models);
  return models;
}

export function parseCatalog(json: unknown): OpenRouterModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const models: OpenRouterModel[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== "string") continue;
    const pricing = (entry.pricing ?? {}) as Record<string, unknown>;
    const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
    models.push({
      id: entry.id,
      name: typeof entry.name === "string" ? entry.name : entry.id,
      contextLength: typeof entry.context_length === "number" ? entry.context_length : 0,
      tools: params.includes("tools"),
      created: typeof entry.created === "number" ? entry.created : 0,
      price: {
        inputPerMillion: perMillion(pricing.prompt) ?? 0,
        outputPerMillion: perMillion(pricing.completion) ?? 0,
        cacheReadPerMillion: perMillion(pricing.input_cache_read),
        cacheWritePerMillion: perMillion(pricing.input_cache_write),
      },
      ...(Number(pricing.prompt) < 0 ? { variablePrice: true } : {}),
    });
  }
  return models;
}

/** Every word of the query must appear in the id or name; only models with tools, newest first. */
export function searchOpenRouterModels(
  models: OpenRouterModel[],
  query: string,
  limit = 25,
): OpenRouterModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return models
    .filter((model) => model.tools && !model.id.endsWith(":batch"))
    .filter((model) => {
      const haystack = `${model.id} ${model.name}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** OpenRouter's `~vendor/family-latest` aliases always point at the newest model of each family. */
export function featuredOpenRouterModels(models: OpenRouterModel[]): OpenRouterModel[] {
  return models
    .filter((model) => model.id.startsWith("~") && model.tools)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function formatOpenRouterModels(models: OpenRouterModel[]): string {
  if (models.length === 0) return "  (nada con tools que coincida)";
  const width = Math.max(...models.map((model) => model.id.length));
  return models
    .map((model) => `  ${model.id.padEnd(width)}  ${openRouterPriceLabel(model)}`)
    .join("\n");
}

export function openRouterPriceLabel(model: OpenRouterModel): string {
  const price = model.variablePrice
    ? "precio variable"
    : `$${formatPricePerMillion(model.price.inputPerMillion)} / $${formatPricePerMillion(model.price.outputPerMillion)} por M`;
  const context = model.contextLength ? ` · ${Math.round(model.contextLength / 1000)}k ctx` : "";
  return `${price}${context}`;
}

export function formatPricePerMillion(value: number): string {
  if (value >= 1) return value.toFixed(2);
  const fixed = value.toFixed(3);
  return fixed.endsWith("0") ? fixed.slice(0, -1) : fixed;
}

function perMillion(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.round(number * 1_000_000 * 1e6) / 1e6;
}

function remember(models: OpenRouterModel[]): void {
  memory = new Map(models.map((model) => [model.id, model]));
}

function readCatalogFile(): CatalogFile | null {
  const file = catalogPath();
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CatalogFile;
    return typeof parsed.fetchedAt === "number" && Array.isArray(parsed.models) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCatalogFile(catalog: CatalogFile): void {
  const file = catalogPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(catalog), "utf8");
  renameSync(tmp, file);
}

/** Test hook: forget the in-memory catalog. */
export function resetOpenRouterMemory(): void {
  memory = null;
}
