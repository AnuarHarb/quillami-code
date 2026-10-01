import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BENCHMARK_ATTRIBUTION } from "./benchmarks.js";
import { configDir } from "./config.js";
import { formatJevSessionUsage } from "./jev.js";
import { priceForModel } from "./models.js";
import { formatTokenCount, formatUsd } from "./tokens.js";

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usd: number;
};

/** What `auto` picked for the coming turn, and the model it is measured against. */
export type AutoRoute = {
  label: string;
  detail?: string;
  baseline: { model: string; label: string };
};

export type UsageLedger = {
  beginTurn(options?: { turnNote?: string }): void;
  /** Call before each turn; null for turns on a fixed model. */
  setAutoRoute(route: AutoRoute | null): void;
  record(model: string, usage: unknown): void;
  turnLine(): string;
  report(): string;
};

const empty = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  usd: 0,
});

export function createUsageLedger(options?: {
  persist?: boolean;
  file?: string;
}): UsageLedger {
  const persist = options?.persist ?? true;
  const file = options?.file ?? path.join(configDir(), "usage.json");
  let lifetime = persist ? loadLifetime(file) : empty();
  let session = empty();
  let turn = empty();
  let turnNote: string | undefined;
  let route: AutoRoute | null = null;
  const routes = new Map<string, { turns: number; detail?: string }>();
  const auto = { usd: 0, baselineUsd: 0, baselineLabel: "" };

  return {
    beginTurn(options) {
      turn = empty();
      turnNote = options?.turnNote;
    },

    setAutoRoute(next) {
      route = next;
      if (!next) return;
      const seen = routes.get(next.label);
      routes.set(next.label, { turns: (seen?.turns ?? 0) + 1, detail: next.detail ?? seen?.detail });
      auto.baselineLabel = next.baseline.label;
    },

    record(model, usage) {
      const parsed = readApiUsage(usage);
      const usd = reportedCostUsd(usage) ?? costUsd(model, parsed);
      add(turn, parsed, usd);
      add(session, parsed, usd);
      add(lifetime, parsed, usd);
      if (route) {
        auto.usd += usd;
        auto.baselineUsd += costUsd(route.baseline.model, parsed);
      }
      if (persist) {
        saveLifetime(file, lifetime);
      }
    },

    turnLine() {
      const note = turnNote ? ` · ${turnNote}` : "";
      return (
        `  tokens: ${formatTokenCount(promptTokens(turn))} in${cacheNote(turn)} · ${formatTokenCount(turn.output)} out` +
        note +
        ` · sesión ${formatTokenCount(promptTokens(session) + session.output)}` +
        ` · ${formatUsd(session.usd)} esta sesión` +
        ` · ${formatUsd(lifetime.usd)} en total`
      );
    },

    report() {
      const row = (label: string, totals: UsageTotals) =>
        `  ${label.padEnd(8)} ${formatTokenCount(promptTokens(totals))} in${cacheNote(totals)} / ${formatTokenCount(totals.output)} out  ${formatUsd(totals.usd)}`;
      const lines = [row("turno", turn), row("sesión", session), row("total", lifetime)];
      if (routes.size > 0) lines.push(...formatAutoReport(routes, auto));
      const jev = formatJevSessionUsage();
      if (jev) lines.push(jev);
      return lines.join("\n");
    },
  };
}

function formatAutoReport(
  routes: Map<string, { turns: number; detail?: string }>,
  auto: { usd: number; baselineUsd: number; baselineLabel: string },
): string[] {
  const picks = [...routes]
    .map(([label, { turns, detail }]) => `${label} ×${turns}${detail ? ` (${detail})` : ""}`)
    .join(" · ");
  const lines = [`  ${"auto".padEnd(8)} ${picks}`];
  if (auto.baselineUsd > 0) {
    const change = Math.round((1 - auto.usd / auto.baselineUsd) * 100);
    const verdict = change >= 0 ? `ahorro ${change}%` : `${-change}% más caro`;
    lines.push(
      `  ${"".padEnd(8)} ${formatUsd(auto.usd)} vs ${formatUsd(auto.baselineUsd)} con ${auto.baselineLabel} siempre (${verdict})`,
    );
  }
  if ([...routes.values()].some((entry) => entry.detail)) {
    lines.push(`  ${"".padEnd(8)} ${BENCHMARK_ATTRIBUTION}`);
  }
  return lines;
}

export function readApiUsage(usage: unknown): Omit<UsageTotals, "usd"> {
  if (!usage || typeof usage !== "object") {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }
  const record = usage as Record<string, unknown>;
  return {
    input: asCount(record.input_tokens),
    output: asCount(record.output_tokens),
    cacheRead: asCount(record.cache_read_input_tokens),
    cacheWrite: asCount(record.cache_creation_input_tokens),
  };
}

/** OpenRouter bills in `usage.cost` (USD); it beats any estimate, and routers have no list price. */
export function reportedCostUsd(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function costUsd(model: string, usage: Omit<UsageTotals, "usd">): number {
  const price = priceForModel(model);
  const cacheWrite =
    price.cacheWritePerMillion ?? price.inputPerMillion * CACHE_WRITE_MULTIPLIER;
  const cacheRead = price.cacheReadPerMillion ?? price.inputPerMillion * CACHE_READ_MULTIPLIER;
  return (
    (usage.input * price.inputPerMillion +
      usage.cacheWrite * cacheWrite +
      usage.cacheRead * cacheRead +
      usage.output * price.outputPerMillion) /
    1_000_000
  );
}

/** input_tokens excludes cached tokens, so the real prompt size is the sum. */
function promptTokens(totals: UsageTotals): number {
  return totals.input + totals.cacheRead + totals.cacheWrite;
}

function cacheNote(totals: UsageTotals): string {
  const prompt = promptTokens(totals);
  if (totals.cacheRead === 0 || prompt === 0) return "";
  const pct = Math.round((totals.cacheRead / prompt) * 100);
  return ` (${pct}% de caché)`;
}

function add(
  target: UsageTotals,
  usage: Omit<UsageTotals, "usd">,
  usd: number,
): void {
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
  target.usd += usd;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function loadLifetime(file: string): UsageTotals {
  if (!existsSync(file)) return empty();
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<UsageTotals>;
    return {
      input: asCount(raw.input),
      output: asCount(raw.output),
      cacheRead: asCount(raw.cacheRead),
      cacheWrite: asCount(raw.cacheWrite),
      usd: asCount(raw.usd),
    };
  } catch {
    return empty();
  }
}

function saveLifetime(file: string, totals: UsageTotals): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(totals, null, 2)}\n`, "utf8");
}
