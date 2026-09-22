import Anthropic from "@anthropic-ai/sdk";
import { type ModelChoice } from "./models.js";

export type Provider = ModelChoice["provider"];

export function keyEnvFor(provider: Provider): string {
  if (provider === "minimax") return "MINIMAX_API_KEY";
  return "ANTHROPIC_API_KEY";
}

export function hasKey(provider: Provider): boolean {
  const value = process.env[keyEnvFor(provider)];
  return typeof value === "string" && value.trim().length > 0;
}

export function createClient(model: ModelChoice): Anthropic {
  const apiKey = process.env[keyEnvFor(model.provider)]?.trim();
  if (!apiKey) {
    throw new Error(`Missing ${keyEnvFor(model.provider)}`);
  }

  if (model.provider === "minimax") {
    const baseURL =
      process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimax.io/anthropic";
    return new Anthropic({ apiKey, baseURL });
  }

  return new Anthropic({ apiKey });
}

export function providerLabel(provider: Provider): string {
  if (provider === "minimax") return "MiniMax";
  return "Anthropic";
}

export function keyHelpUrl(provider: Provider): string {
  if (provider === "minimax") return "https://platform.minimax.io";
  return "https://console.anthropic.com";
}
