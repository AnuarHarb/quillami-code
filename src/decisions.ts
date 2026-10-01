import { noul, score, type ScoreResponse } from "@typesafe-ai/sdk";
import { askJev } from "./jev.js";
import { MODELS, type ModelChoice } from "./models.js";

export type RiskInput = {
  tool: string;
  command?: string;
  path?: string;
  workspace: string;
};

export type JevRiskAnswer = {
  score: number;
  confidence: number;
};

export type RiskPolicyResult =
  | { action: "allow"; note: string }
  | { action: "deny"; note: string; toolMessage: string }
  | { action: "ask"; note?: string; forceAsk: boolean };

const RISK_CRITERIA = [
  "0 — solo lectura (ls, cat, git status, git diff, grep)",
  "1 — cambio local reversible (editar en el workspace, npm test, build)",
  "2 — difícil de revertir o fuera del workspace (borrar, git push, reset --hard, instalar global, red)",
  "3 — destructivo o peligroso (rm -rf amplio, curl | sh, credenciales)",
] as const;

const COMPLEXITY_CRITERIA = [
  "trivial — pregunta corta, un paso, sin arquitectura",
  "estándar — programación normal en el repo",
  "difícil — diseño, muchos archivos, debugging profundo o refactor grande",
] as const;

export const RISK_AUTO_MAX_SCORE = 0.5;
export const RISK_AUTO_MIN_CONFIDENCE = 0.8;
export const RISK_BLOCK_MIN_SCORE = 2.5;
export const RISK_BLOCK_MIN_CONFIDENCE = 0.85;
export const RISK_FORCE_ASK_MIN_SCORE = 2;
export const COMPLEXITY_MIN_CONFIDENCE = 0.6;

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[a-zA-Z0-9]{20,}\b/,
  /\beb_sk_[a-zA-Z0-9]+\b/,
  /\bghp_[a-zA-Z0-9]{20,}\b/,
  /\bgho_[a-zA-Z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(xox[baprs]-)[a-zA-Z0-9-]{10,}\b/,
  /\bTYPESAFE_API_KEY\s*=/i,
  /\bANTHROPIC_API_KEY\s*=/i,
  /\bMINIMAX_API_KEY\s*=/i,
];

export function riskQuestions() {
  return {
    risk: score(
      "How risky is this tool use for the user's machine and data?",
      RISK_CRITERIA,
    ),
  };
}

export function complexityQuestions() {
  return {
    complexity: score(
      "How complex is this user message for a coding agent?",
      COMPLEXITY_CRITERIA,
    ),
  };
}

export function memoryQuestions() {
  return {
    user_fact: noul(
      "Does the message state a durable fact about the user (role, stack, goals, long-term preference)?",
    ),
    behavior_pref: noul(
      "Does the message state a durable preference for how the assistant should behave (tone, language, workflow)?",
    ),
    has_secret: noul(
      "Does the message contain or ask to store secrets, API keys, passwords, or .env contents?",
    ),
  };
}

export function matchesDenylist(input: RiskInput): boolean {
  if (input.tool !== "bash") return false;
  const cmd = (input.command ?? "").toLowerCase();
  if (!cmd) return false;
  if (/\bsudo\b/.test(cmd)) return true;
  if (/\brm\s+(-[^\s]*\s+)*-[^\s]*r|rm\s+-rf\b/.test(cmd)) return true;
  if (/\|\s*sh\b/.test(cmd)) return true;
  if (/\b(curl|wget)\b/.test(cmd)) return true;
  if (/\bgit\s+push\b/.test(cmd)) return true;
  if (/>/.test(cmd) && pathOutsideWorkspace(cmd, input.workspace)) return true;
  return false;
}

function pathOutsideWorkspace(command: string, workspace: string): boolean {
  const redirect = command.match(/>\s*([^\s|;&]+)/);
  if (!redirect) return false;
  const target = redirect[1].replace(/^["']|["']$/g, "");
  if (target.startsWith("/dev/") || target === "/dev/null") return false;
  if (target.startsWith("~/")) return true;
  if (target.startsWith("/")) {
    const ws = workspace.replace(/\/+$/, "");
    return !target.startsWith(ws + "/") && target !== ws;
  }
  return false;
}

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function applyRiskPolicy(
  tool: string,
  input: RiskInput,
  jev: JevRiskAnswer | null,
): RiskPolicyResult {
  const onDenylist = matchesDenylist(input);

  if (tool === "write" || tool === "edit") {
    const note = jev
      ? formatRiskNote(jev, "write/edit siempre pide permiso")
      : undefined;
    return { action: "ask", note, forceAsk: false };
  }

  if (tool !== "bash") {
    return { action: "ask", forceAsk: false };
  }

  if (!jev) {
    return { action: "ask", forceAsk: false };
  }

  const { score: level, confidence } = jev;

  if (
    level >= RISK_BLOCK_MIN_SCORE &&
    confidence >= RISK_BLOCK_MIN_CONFIDENCE
  ) {
    return {
      action: "deny",
      note: `· bloqueado: riesgo alto (Jev ${level.toFixed(2)}, ${confidence.toFixed(2)})`,
      toolMessage:
        "This command was blocked as high risk. Explain the risk to the user and suggest they run it manually if they still want it. Do not retry this command.",
    };
  }

  const forceAsk = level >= RISK_FORCE_ASK_MIN_SCORE || onDenylist;

  if (
    !onDenylist &&
    level < RISK_AUTO_MAX_SCORE &&
    confidence >= RISK_AUTO_MIN_CONFIDENCE
  ) {
    return {
      action: "allow",
      note: `· auto: solo lectura (Jev ${confidence.toFixed(2)})`,
    };
  }

  const note = formatRiskNote(jev, onDenylist ? "comando en denylist" : undefined);
  return { action: "ask", note, forceAsk };
}

function formatRiskNote(jev: JevRiskAnswer, suffix?: string): string {
  const base = `· riesgo Jev ${jev.score.toFixed(2)} (conf. ${jev.confidence.toFixed(2)})`;
  return suffix ? `${base} · ${suffix}` : base;
}

export function parseJevRisk(
  answer: ScoreResponse<typeof RISK_CRITERIA> | undefined,
): JevRiskAnswer | null {
  if (!answer || answer.type !== "score") return null;
  return { score: answer.score, confidence: answer.confidence };
}

export function pickModelForComplexity(
  answer: ScoreResponse<typeof COMPLEXITY_CRITERIA> | undefined,
): { model: ModelChoice; reason: string } {
  const fallback =
    MODELS.find((m) => m.id === "claude-sonnet-4-5") ?? MODELS[0];
  const haiku = MODELS.find((m) => m.alias === "haiku") ?? fallback;
  const sonnet = fallback;
  const opus = MODELS.find((m) => m.alias === "opus") ?? sonnet;

  if (!answer || answer.confidence < COMPLEXITY_MIN_CONFIDENCE) {
    return { model: sonnet, reason: "confianza baja o sin Jev → Sonnet" };
  }

  if (answer.score < 0.75) {
    return {
      model: haiku,
      reason: `trivial, ${answer.confidence.toFixed(2)}`,
    };
  }
  if (answer.score < 1.75) {
    return {
      model: sonnet,
      reason: `estándar, ${answer.confidence.toFixed(2)}`,
    };
  }
  return {
    model: opus,
    reason: `difícil, ${answer.confidence.toFixed(2)}`,
  };
}

export type MemoryNoulAnswers = {
  user_fact: number;
  behavior_pref: number;
  has_secret: number;
};

type RawNoulAnswers = Record<
  string,
  { type: string; noul?: number } | undefined
> | null;

export function parseMemoryNouls(answers: RawNoulAnswers): MemoryNoulAnswers | null {
  if (!answers) return null;
  const uf = answers.user_fact;
  const bp = answers.behavior_pref;
  const hs = answers.has_secret;
  if (!uf || uf.type !== "noul" || !bp || bp.type !== "noul" || !hs || hs.type !== "noul") {
    return null;
  }
  return {
    user_fact: uf.noul ?? 0,
    behavior_pref: bp.noul ?? 0,
    has_secret: hs.noul ?? 0,
  };
}

export const MEMORY_NOUL_THRESHOLD = 0.8;

export function shouldProposeAutoMemory(
  nouls: MemoryNoulAnswers | null,
  userMessage: string,
): { propose: boolean; target: "user" | "behaviors" } | null {
  if (looksLikeSecret(userMessage)) return null;
  if (!nouls) return null;
  if (nouls.has_secret >= MEMORY_NOUL_THRESHOLD) return null;

  if (nouls.user_fact >= MEMORY_NOUL_THRESHOLD) {
    return { propose: true, target: "user" };
  }
  if (nouls.behavior_pref >= MEMORY_NOUL_THRESHOLD) {
    return { propose: true, target: "behaviors" };
  }
  return null;
}

export async function assessToolRisk(input: RiskInput): Promise<JevRiskAnswer | null> {
  const answers = await askJev(input, riskQuestions());
  return parseJevRisk(answers?.risk as ScoreResponse<typeof RISK_CRITERIA> | undefined);
}

export async function assessMessageComplexity(
  userMessage: string,
): Promise<{ model: ModelChoice; reason: string }> {
  const answers = await askJev(userMessage, complexityQuestions());
  return pickModelForComplexity(
    answers?.complexity as ScoreResponse<typeof COMPLEXITY_CRITERIA> | undefined,
  );
}

export async function assessMemorySignals(userMessage: string): Promise<MemoryNoulAnswers | null> {
  const answers = await askJev(userMessage, memoryQuestions());
  return parseMemoryNouls(answers as RawNoulAnswers);
}
