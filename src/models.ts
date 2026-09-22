export type ModelPrice = {
  inputPerMillion: number;
  outputPerMillion: number;
};

export type Provider = "anthropic" | "minimax";

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

export const MINIMAX_M3_ID = "MiniMax-M3";

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
    id: MINIMAX_M3_ID,
    alias: "minimax",
    label: "MiniMax M3",
    provider: "minimax",
    blurb: "Agente, tools y contexto largo",
    price: MINIMAX_M3_PRICE,
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-4-5";

export function resolveModel(raw: string | undefined): ModelChoice | null {
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;

  const listed = MODELS.find(
    (model) =>
      model.id.toLowerCase() === needle ||
      model.alias.toLowerCase() === needle ||
      model.label.toLowerCase() === needle,
  );
  if (listed) return listed;

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

export function defaultModel(): ModelChoice {
  const fromEnv =
    resolveModel(process.env.QUILLAMI_MODEL) ??
    resolveModel(process.env.KILLAMI_MODEL) ??
    resolveModel(process.env.ANTHROPIC_MODEL);
  if (fromEnv) return fromEnv;

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const minimaxKey = process.env.MINIMAX_API_KEY?.trim();
  if (!anthropicKey && minimaxKey) {
    return MODELS.find((model) => model.id === MINIMAX_M3_ID) ?? MODELS[0];
  }

  return (
    MODELS.find((model) => model.id === DEFAULT_MODEL_ID) ??
    MODELS[0]
  );
}

export function formatModelLine(model: ModelChoice): string {
  return `${model.label} (${model.alias} · ${model.id})`;
}

export function priceForModel(id: string): ModelPrice {
  return resolveModel(id)?.price ?? SONNET5_PRICE;
}

export function formatModelList(currentId: string): string {
  return MODELS.map((model) => {
    const mark = model.id === currentId ? "*" : " ";
    const tag = model.provider === "minimax" ? "MiniMax" : "Anthropic";
    return `  ${mark} ${model.alias.padEnd(10)} ${model.label.padEnd(14)} ${tag.padEnd(10)} ${model.blurb}`;
  }).join("\n");
}
