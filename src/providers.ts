import Anthropic from "@anthropic-ai/sdk";
import { type ModelChoice } from "./models.js";
import { OPENROUTER_BASE_URL } from "./openrouter.js";

export type Provider = ModelChoice["provider"];

export const PROVIDERS: Provider[] = ["anthropic", "minimax", "openrouter"];

export function keyEnvFor(provider: Provider): string {
  if (provider === "minimax") return "MINIMAX_API_KEY";
  if (provider === "openrouter") return "OPENROUTER_API_KEY";
  return "ANTHROPIC_API_KEY";
}

export function hasKey(provider: Provider): boolean {
  const value = process.env[keyEnvFor(provider)];
  return typeof value === "string" && value.trim().length > 0;
}

export function anyProviderKey(): boolean {
  return PROVIDERS.some((provider) => hasKey(provider));
}

/**
 * apiKey and authToken are always passed explicitly: the SDK otherwise reads
 * ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from the environment and would send
 * the Anthropic key to MiniMax or OpenRouter.
 */
export function createClient(model: ModelChoice): Anthropic {
  const key = process.env[keyEnvFor(model.provider)]?.trim();
  if (!key) {
    throw new Error(`Missing ${keyEnvFor(model.provider)}`);
  }

  if (model.provider === "minimax") {
    const baseURL =
      process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimax.io/anthropic";
    return new Anthropic({ apiKey: key, authToken: null, baseURL });
  }

  if (model.provider === "openrouter") {
    return new Anthropic({
      apiKey: null,
      authToken: key,
      baseURL: process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/AnuarHarb/killa-code",
        "X-Title": "Quillami Code",
      },
    });
  }

  return new Anthropic({ apiKey: key, authToken: null });
}

export function providerLabel(provider: Provider): string {
  if (provider === "minimax") return "MiniMax";
  if (provider === "openrouter") return "OpenRouter";
  return "Anthropic";
}

export function keyHelpUrl(provider: Provider): string {
  if (provider === "minimax") return "https://platform.minimax.io";
  if (provider === "openrouter") return "https://openrouter.ai/keys";
  return "https://console.anthropic.com";
}
