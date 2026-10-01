import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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

export type UsageLedger = {
  beginTurn(options?: { turnNote?: string }): void;
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

  return {
    beginTurn(options) {
      turn = empty();
      turnNote = options?.turnNote;
    },

    record(model, usage) {
      const parsed = readApiUsage(usage);
      const usd = costUsd(model, parsed);
      add(turn, parsed, usd);
      add(session, parsed, usd);
      add(lifetime, parsed, usd);
      if (persist) {
        saveLifetime(file, lifetime);
      }
    },

    turnLine() {
      const note = turnNote ? ` · ${turnNote}` : "";
      return (
        `  tokens: ${formatTokenCount(turn.input)} in · ${formatTokenCount(turn.output)} out` +
        note +
        ` · sesión ${formatTokenCount(session.input + session.output)}` +
        ` · ${formatUsd(session.usd)} esta sesión` +
        ` · ${formatUsd(lifetime.usd)} en total`
      );
    },

    report() {
      const lines = [
        `  turno    ${formatTokenCount(turn.input)} in / ${formatTokenCount(turn.output)} out  ${formatUsd(turn.usd)}`,
        `  sesión   ${formatTokenCount(session.input)} in / ${formatTokenCount(session.output)} out  ${formatUsd(session.usd)}`,
        `  total    ${formatTokenCount(lifetime.input)} in / ${formatTokenCount(lifetime.output)} out  ${formatUsd(lifetime.usd)}`,
      ];
      const jev = formatJevSessionUsage();
      if (jev) lines.push(jev);
      return lines.join("\n");
    },
  };
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

function costUsd(model: string, usage: Omit<UsageTotals, "usd">): number {
  const price = priceForModel(model);
  const billedInput = usage.input + usage.cacheWrite;
  return (
    (billedInput / 1_000_000) * price.inputPerMillion +
    (usage.output / 1_000_000) * price.outputPerMillion
  );
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
