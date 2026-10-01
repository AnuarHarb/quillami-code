import { benchmarksEnabled } from "./benchmarks.js";
import {
  cachedOpenRouterModel,
  isOpenRouterId,
  OPENROUTER_DEFAULT_ID,
} from "./openrouter.js";

export type ModelPrice = {
  inputPerMillion: number;
  outputPerMillion: number;
  /** When absent, cache reads and writes are priced as multiples of input. */
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
};

export type Provider = "anthropic" | "minimax" | "openrouter";

export type ModelChoice = {
  id: string;
  alias: string;
  label: string;
  provider: Provider;
  blurb: string;
  price: ModelPrice;
};

const SONNET5_PRICE = { inputPerMillion: 2, outputPerMillion: 10 };
const SONNET45_PRICE = { inputPerMillion: 3, outputPerMillion: 15 };
const OPUS_PRICE = { inputPerMillion: 5, outputPerMillion: 25 };
const FABLE_PRICE = { inputPerMillion: 10, outputPerMillion: 50 };
const HAIKU_PRICE = { inputPerMillion: 1, outputPerMillion: 5 };
const MINIMAX_M3_PRICE = { inputPerMillion: 0.3, outputPerMillion: 1.2 };
const UNKNOWN_PRICE = { inputPerMillion: 0, outputPerMillion: 0 };

export const MINIMAX_M3_ID = "MiniMax-M3";
export const AUTO_MODEL_ID = "auto";

export const MODELS: ModelChoice[] = [
  {
    id: "claude-sonnet-5",
    alias: "sonnet",
    label: "Sonnet 5",
    provider: "anthropic",
    blurb: "Rápido y bueno pa' programar",
    price: SONNET5_PRICE,
  },
  {
    id: "claude-sonnet-4-5",
    alias: "sonnet-4.5",
    label: "Sonnet 4.5",
    provider: "anthropic",
    blurb: "El que veníamos usando",
    price: SONNET45_PRICE,
  },
  {
    id: "claude-opus-5",
    alias: "opus",
    label: "Opus 5",
    provider: "anthropic",
    blurb: "Más capaz, más lento y más caro",
    price: OPUS_PRICE,
  },
  {
    id: "claude-fable-5-1",
    alias: "fable",
    label: "Fable 5.1",
    provider: "anthropic",
    blurb: "Pa' razonar largo y agentes pesados",
    price: FABLE_PRICE,
  },
  {
    id: "claude-haiku-4-5",
    alias: "haiku",
    label: "Haiku 4.5",
    provider: "anthropic",
    blurb: "Liviano, pa' cosas rápidas",
    price: HAIKU_PRICE,
  },
  {
    id: OPENROUTER_DEFAULT_ID,
    alias: "openrouter",
    label: "OpenRouter",
    provider: "openrouter",
    blurb: "Sonnet 5 vía OpenRouter; cualquier otro: /model vendor/modelo",
    price: SONNET5_PRICE,
  },
];

/** Still works with MINIMAX_API_KEY, but is not offered in lists or onboarding. */
const MINIMAX_MODEL: ModelChoice = {
  id: MINIMAX_M3_ID,
  alias: "minimax",
  label: "MiniMax M3",
  provider: "minimax",
  blurb: "Agente, tools y contexto largo",
  price: MINIMAX_M3_PRICE,
};

export const DEFAULT_MODEL_ID = "claude-sonnet-4-5";

export function isAutoModel(model: ModelChoice): boolean {
  return model.id === AUTO_MODEL_ID;
}

/**
 * With benchmarks, auto picks among OpenRouter models. Otherwise Claude
 * directly when there is an Anthropic key, or the same tiers via OpenRouter.
 */
function autoProvider(): Provider | null {
  if (benchmarksEnabled()) return "openrouter";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  return null;
}

function autoModelChoice(): ModelChoice | null {
  const provider = autoProvider();
  if (!provider) return null;
  return {
    id: AUTO_MODEL_ID,
    alias: "auto",
    label: "Auto (Jev)",
    provider,
    blurb: benchmarksEnabled()
      ? "Jev elige el modelo más barato que cumple, según benchmarks"
      : "Jev elige el modelo para cada tarea",
    price: SONNET45_PRICE,
  };
}

const OPENROUTER_TIERS = {
  light: "~anthropic/claude-haiku-latest",
  standard: "~anthropic/claude-sonnet-latest",
  heavy: "~anthropic/claude-opus-latest",
} as const;

/** The three models `auto` routes between, on the provider `auto` resolved to. */
export function autoTiers(provider: Provider): {
  light: ModelChoice;
  standard: ModelChoice;
  heavy: ModelChoice;
} {
  if (provider === "openrouter") {
    return {
      light: { ...openRouterChoice(OPENROUTER_TIERS.light), label: "Claude Haiku" },
      standard: { ...openRouterChoice(OPENROUTER_TIERS.standard), label: "Claude Sonnet" },
      heavy: { ...openRouterChoice(OPENROUTER_TIERS.heavy), label: "Claude Opus" },
    };
  }
  const standard = MODELS.find((m) => m.id === DEFAULT_MODEL_ID) ?? MODELS[0];
  return {
    light: MODELS.find((m) => m.alias === "haiku") ?? standard,
    standard,
    heavy: MODELS.find((m) => m.alias === "opus") ?? standard,
  };
}

export function resolveModel(raw: string | undefined): ModelChoice | null {
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;

  if (needle === "auto") {
    return autoModelChoice();
  }

  const listed = [...MODELS, MINIMAX_MODEL].find(
    (model) =>
      model.id.toLowerCase() === needle ||
      model.alias.toLowerCase() === needle ||
      model.label.toLowerCase() === needle,
  );
  if (listed) {
    return listed.provider === "openrouter" ? openRouterChoice(listed.id, listed) : listed;
  }

  if (isOpenRouterId(raw)) {
    return openRouterChoice(raw.trim());
  }

  if (needle.startsWith("claude-")) {
    return {
      id: raw.trim(),
      alias: raw.trim(),
      label: raw.trim(),
      provider: "anthropic",
      blurb: "ID directo",
      price: SONNET5_PRICE,
    };
  }

  if (needle.startsWith("minimax-")) {
    return {
      id: raw.trim(),
      alias: raw.trim(),
      label: raw.trim(),
      provider: "minimax",
      blurb: "ID directo",
      price: MINIMAX_M3_PRICE,
    };
  }

  return null;
}

/** Price comes from the cached OpenRouter catalog when it has the model. */
function openRouterChoice(id: string, base?: ModelChoice): ModelChoice {
  const known = cachedOpenRouterModel(id);
  return {
    id,
    alias: base?.alias ?? id,
    label: base?.label ?? known?.name ?? id,
    provider: "openrouter",
    blurb: base?.blurb ?? "vía OpenRouter",
    price: known?.price ?? base?.price ?? UNKNOWN_PRICE,
  };
}

export function defaultModel(): ModelChoice {
  const fromEnv =
    resolveModel(process.env.QUILLAMI_MODEL) ??
    resolveModel(process.env.KILLAMI_MODEL) ??
    resolveModel(process.env.ANTHROPIC_MODEL);
  if (fromEnv) return fromEnv;

  if (process.env.TYPESAFE_API_KEY?.trim() && process.env.QUILLAMI_JEV !== "0") {
    const auto = autoModelChoice();
    if (auto) return auto;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const minimaxKey = process.env.MINIMAX_API_KEY?.trim();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!anthropicKey && openRouterKey) {
    return resolveModel("openrouter") ?? MODELS[0];
  }
  if (!anthropicKey && minimaxKey) return MINIMAX_MODEL;

  return (
    MODELS.find((model) => model.id === DEFAULT_MODEL_ID) ??
    MODELS[0]
  );
}

export function formatModelLine(model: ModelChoice): string {
  if (isAutoModel(model)) return model.label;
  if (model.alias === model.id) return `${model.label} (${model.id})`;
  return `${model.label} (${model.alias} · ${model.id})`;
}

export function priceForModel(id: string): ModelPrice {
  return resolveModel(id)?.price ?? SONNET5_PRICE;
}

export function formatModelList(currentId: string): string {
  const lines: string[] = [];
  const auto = autoModelChoice();
  if (auto) {
    const mark = auto.id === currentId ? "*" : " ";
    const tag = auto.provider === "openrouter" ? "OpenRouter" : "Anthropic";
    lines.push(
      `  ${mark} ${auto.alias.padEnd(10)} ${auto.label.padEnd(14)} ${tag.padEnd(10)} ${auto.blurb}`,
    );
  }
  lines.push(
    ...MODELS.map((model) => {
      const mark = model.id === currentId ? "*" : " ";
      const tag = model.provider === "openrouter" ? "OpenRouter" : "Anthropic";
      return `  ${mark} ${model.alias.padEnd(10)} ${model.label.padEnd(14)} ${tag.padEnd(10)} ${model.blurb}`;
    }),
  );
  return lines.join("\n");
}
