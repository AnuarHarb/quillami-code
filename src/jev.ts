import {
  TypeSafeClient,
  type EntryType,
  type Fetch,
  type Questions,
  type SystemOneResult,
  type Usage,
} from "@typesafe-ai/sdk";
import { JEV_ROUTER_ID } from "./openrouter.js";

const JEV_TIMEOUT_MS = 4_000;
const JEV_RETRY = { maxRetries: 1 } as const;

let lazyClient: TypeSafeClient | null = null;

let sessionCalls = 0;
let sessionInputTokens = 0;
let sessionOutputTokens = 0;

export function jevEnabled(): boolean {
  if (process.env.QUILLAMI_JEV === "0") return false;
  const key = process.env.TYPESAFE_API_KEY?.trim();
  return typeof key === "string" && key.length > 0;
}

export function jevBannerLine(): string {
  if (jevEnabled()) return "jev: activo";
  return process.env.QUILLAMI_JEV === "0"
    ? "jev: apagado (QUILLAMI_JEV=0)"
    : "jev: apagado (/setup para añadir tu key)";
}

/** OpenRouter answered with a different model than requested (Jev Router or a ~latest alias). */
export function formatServedModel(requested: string, served: string): string {
  return requested === JEV_ROUTER_ID
    ? `· jev · responde con ${served}`
    : `· openrouter · ${requested} → ${served}`;
}

export function recordJevUsage(usage: Usage): void {
  sessionCalls += 1;
  sessionInputTokens += usage.input_tokens;
  sessionOutputTokens += usage.output_tokens;
}

export function formatJevSessionUsage(): string | null {
  if (sessionCalls === 0) return null;
  return (
    `  jev      ${sessionCalls} llamada${sessionCalls === 1 ? "" : "s"}` +
    ` · ${sessionInputTokens} in / ${sessionOutputTokens} out (tokens)`
  );
}

export function resetJevSessionUsageForTests(): void {
  sessionCalls = 0;
  sessionInputTokens = 0;
  sessionOutputTokens = 0;
  lazyClient = null;
}

function clientOptions(fetch?: Fetch): ConstructorParameters<typeof TypeSafeClient>[0] {
  return {
    apiKey: process.env.TYPESAFE_API_KEY!.trim(),
    timeout: JEV_TIMEOUT_MS,
    retry: JEV_RETRY,
    logLevel: "off",
    ...(fetch ? { fetch } : {}),
  };
}

function getClient(fetch?: Fetch): TypeSafeClient {
  if (fetch) {
    return new TypeSafeClient(clientOptions(fetch));
  }
  if (!lazyClient) {
    lazyClient = new TypeSafeClient(clientOptions());
  }
  return lazyClient;
}

export async function askJev<const Q extends Questions>(
  state: EntryType,
  questions: Q,
  options?: { fetch?: Fetch },
): Promise<SystemOneResult<Q>["answers"] | null> {
  if (!jevEnabled()) return null;
  try {
    const client = getClient(options?.fetch);
    const result = await client.systemOne(
      { state, questions },
      { timeout: JEV_TIMEOUT_MS, retry: JEV_RETRY },
    );
    recordJevUsage(result.usage);
    return result.answers;
  } catch {
    return null;
  }
}
