import { dim } from "./banner.js";
import { isAutoModel, MODELS, resolveModel, type ModelChoice } from "./models.js";
import {
  featuredOpenRouterModels,
  openRouterPriceLabel,
  searchOpenRouterModels,
  type OpenRouterModel,
} from "./openrouter.js";
import { hasKey, providerLabel } from "./providers.js";
import type { Choice, Selector } from "./select.js";

export type PickerEntry = { id: string; line: string; section: "auto" | "direct" | "openrouter" };

type PickerOptions = {
  ask: (prompt: string) => Promise<string>;
  print: (text: string) => void;
  currentId?: string;
  catalog: OpenRouterModel[] | null;
  /** Start on search results instead of the default list. */
  query?: string;
  /** Arrow-key list in a terminal; without it, the choice is typed. */
  select?: Selector;
};

const MAX_ROUNDS = 10;
const SEARCH_LIMIT = 20;

/**
 * Direct models plus OpenRouter's featured aliases; typing searches the whole
 * catalog. Returns the id to resolve, or null when the user leaves.
 */
export async function pickModel(options: PickerOptions): Promise<string | null> {
  let entries = options.query
    ? searchEntries(options.catalog, options.query)
    : defaultEntries(options.catalog, options.currentId);

  if (options.select) {
    const current = entries.findIndex((entry) => entry.line.endsWith("← actual"));
    return options.select.one("¿Qué modelo usas?", entryChoices(entries, options.query), {
      initial: Math.max(current, 0),
      search: options.catalog
        ? (query) => entryChoices(searchEntries(options.catalog, query), query)
        : undefined,
      emptyText: "nada con tools que coincida; prueba otra palabra",
      summary: ([id]) => id,
    });
  }

  options.print(renderEntries(entries, options.query));

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const answer = (
      await options.ask("Número, alias o id · texto para buscar · Enter para salir: ")
    ).trim();
    if (!answer) return null;

    const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
    if (index >= 0) {
      const picked = entries[index];
      if (picked) return picked.id;
      options.print(dim(`   no hay opción ${answer}.`));
      continue;
    }

    if (resolveModel(answer)) return answer;

    if (!options.catalog) {
      options.print(dim(`   no conozco "${answer}" y no pude leer el catálogo de OpenRouter.`));
      continue;
    }
    const found = searchEntries(options.catalog, answer);
    if (found.length === 0) {
      options.print(dim(`   nada con tools que coincida con "${answer}". Prueba otra palabra.`));
      continue;
    }
    entries = found;
    options.print(renderEntries(entries, answer));
  }
  return null;
}

export function defaultEntries(
  catalog: OpenRouterModel[] | null,
  currentId?: string,
): PickerEntry[] {
  const list: ModelChoice[] = [];
  const auto = resolveModel("auto");
  if (auto) list.push(auto);
  // With OpenRouter but no Anthropic key, Claude is already in the OpenRouter section.
  const showDirects = hasKey("anthropic") || !hasKey("openrouter");
  if (showDirects) list.push(...MODELS.filter((model) => model.provider !== "openrouter"));
  else if (!catalog) list.push(...MODELS.filter((model) => model.alias === "openrouter"));
  const width = Math.max(0, ...list.map((model) => model.alias.length));
  const labelWidth = Math.max(0, ...list.map((model) => model.label.length));
  const entries: PickerEntry[] = list.map((model) => ({
    id: model.alias,
    section: isAutoModel(model) ? "auto" : "direct",
    line: `${model.alias.padEnd(width)}  ${model.label.padEnd(labelWidth)}  ${providerLabel(model.provider).padEnd(10)}${keyNote(model)}${model.id === currentId ? "  ← actual" : ""}`,
  }));
  if (catalog) entries.push(...openRouterEntries(featuredOpenRouterModels(catalog), currentId));
  return entries;
}

function searchEntries(catalog: OpenRouterModel[] | null, query: string): PickerEntry[] {
  if (!catalog) return [];
  return openRouterEntries(searchOpenRouterModels(catalog, query, SEARCH_LIMIT));
}

function openRouterEntries(models: OpenRouterModel[], currentId?: string): PickerEntry[] {
  if (models.length === 0) return [];
  const width = Math.max(...models.map((model) => model.id.length));
  const missingKey = hasKey("openrouter") ? "" : "  (falta key)";
  return models.map((model) => ({
    id: model.id,
    section: "openrouter" as const,
    line: `${model.id.padEnd(width)}  ${openRouterPriceLabel(model)}${missingKey}${model.id === currentId ? "  ← actual" : ""}`,
  }));
}

function keyNote(model: ModelChoice): string {
  if (!hasKey(model.provider)) return "  (falta key)";
  if (isAutoModel(model) && !process.env.TYPESAFE_API_KEY?.trim()) return "  (falta key de Jev)";
  return "";
}

const SECTION_HEADERS: Record<PickerEntry["section"], string> = {
  auto: "Recomendado",
  direct: "Directos",
  openrouter: "OpenRouter · siempre la versión más nueva de cada familia (precio USD por M de tokens)",
};

function searchHeader(query: string): string {
  return `OpenRouter · "${query}" · lo más nuevo primero (precio USD por M de tokens)`;
}

function entryChoices(entries: PickerEntry[], query?: string): Choice<string>[] {
  return entries.map((entry) => ({
    value: entry.id,
    label: entry.line,
    section: query ? searchHeader(query) : SECTION_HEADERS[entry.section],
  }));
}

export function renderEntries(entries: PickerEntry[], query?: string): string {
  if (entries.length === 0) return "\n  (nada que mostrar)\n";
  if (query) {
    return `\n${dim(`  ${searchHeader(query)}`)}\n${numbered(entries).join("\n")}\n`;
  }
  const lines: string[] = [];
  numbered(entries).forEach((line, index) => {
    const section = entries[index].section;
    if (index === 0 || entries[index - 1].section !== section) {
      if (index > 0) lines.push("");
      lines.push(dim(`  ${SECTION_HEADERS[section]}`));
    }
    lines.push(line);
  });
  return `\n${lines.join("\n")}\n`;
}

function numbered(entries: PickerEntry[]): string[] {
  const width = String(entries.length).length;
  return entries.map((entry, index) => `  ${String(index + 1).padStart(width)}  ${entry.line}`);
}
