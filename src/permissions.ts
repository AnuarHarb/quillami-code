import { dim } from "./banner.js";
import { CONFIG_DIR_NAME } from "./config.js";
import {
  applyRiskPolicy,
  assessToolRisk,
  matchesDenylist,
  type RiskInput,
  type RiskPolicyResult,
} from "./decisions.js";
import type { AgentMode } from "./mode.js";
import { isPlanBlockedTool } from "./toolRegistry.js";

const RISKY_TOOLS = new Set(["write", "edit", "bash", "remember_user", "web_fetch"]);

export type AskFn = (prompt: string) => Promise<string>;

export type AssessRiskFn = (
  name: string,
  input: unknown,
) => Promise<RiskPolicyResult | null>;

export type AuthorizeResult = {
  allowed: boolean;
  toolMessage?: string;
};

export type PermissionGate = {
  authorize(name: string, input: unknown): Promise<AuthorizeResult>;
};

export function needsApproval(name: string): boolean {
  if (name.startsWith("mcp__")) return true;
  return RISKY_TOOLS.has(name);
}

export function createGate(
  ask: AskFn,
  options?: {
    assessRisk?: AssessRiskFn;
    getMode?: () => AgentMode;
    nonInteractive?: boolean;
  },
): PermissionGate {
  let allowSession = false;

  return {
    async authorize(name, input) {
      if (!needsApproval(name)) {
        return { allowed: true };
      }

      const mode = options?.getMode?.() ?? "agent";

      if (mode === "plan" && isPlanBlockedTool(name)) {
        return {
          allowed: false,
          toolMessage:
            "Plan mode is active: use read-only tools and finish with a written plan. Do not call write, edit, bash, web_fetch, remember_user, or MCP tools until the user switches to agent mode.",
        };
      }

      const riskInput = toRiskInput(name, input);
      let policy: RiskPolicyResult | null = null;
      if (options?.assessRisk) {
        policy = await options.assessRisk(name, input);
      } else if (riskInput) {
        policy = applyRiskPolicy(name, riskInput, null);
      }

      if (policy?.action === "deny") {
        process.stdout.write(`${dim(`  ${policy.note}`)}\n`);
        return {
          allowed: false,
          toolMessage: policy.toolMessage,
        };
      }

      if (mode === "yolo") {
        const onDenylist =
          name === "bash" && riskInput ? matchesDenylist(riskInput) : false;
        if (onDenylist) {
          // fall through to prompt
        } else if (policy?.action === "allow") {
          process.stdout.write(`${dim(`  ${policy.note}`)}\n`);
          return { allowed: true };
        } else {
          return { allowed: true };
        }
      } else if (policy?.action === "allow") {
        process.stdout.write(`${dim(`  ${policy.note}`)}\n`);
        return { allowed: true };
      }

      const forceAsk =
        policy && policy.action === "ask" ? policy.forceAsk : false;
      if (allowSession && !forceAsk && mode !== "yolo") {
        return { allowed: true };
      }

      if (options?.nonInteractive && mode !== "yolo") {
        return {
          allowed: false,
          toolMessage:
            "Non-interactive mode denied this action. Re-run with a TTY or use --yolo.",
        };
      }

      const detail = describeAction(name, input, policy?.note);
      if (detail) {
        process.stdout.write(`${dim(`  ${detail}`)}\n`);
      }

      process.stdout.write(
        `${dim("  s  sí, solo esta vez")}\n` +
          `${dim("  n  no, no lo toques")}\n` +
          `${dim("  a  sí, y no preguntes más en esta sesión")}\n`,
      );

      const decision = await askDecision(ask);
      if (decision === "deny") {
        process.stdout.write(`${dim("  Listo, no lo toco.")}\n`);
        return { allowed: false };
      }
      if (decision === "allow_session" && !forceAsk) {
        allowSession = true;
        process.stdout.write(`${dim("  Va, esta sesión no pregunto más.")}\n`);
      }
      return { allowed: true };
    },
  };
}

export function createAssessRisk(workspace: string): AssessRiskFn {
  return async (name, input) => {
    const riskInput = toRiskInput(name, input);
    if (!riskInput) return null;
    if (workspace) {
      riskInput.workspace = workspace;
    }

    const jev = name === "bash" ? await assessToolRisk(riskInput) : null;
    return applyRiskPolicy(name, riskInput, jev);
  };
}

function toRiskInput(name: string, input: unknown): RiskInput | null {
  const args = asRecord(input);
  if (name === "bash") {
    const command = stringArg(args.command);
    if (!command) return null;
    return {
      tool: "bash",
      command,
      workspace: process.cwd(),
    };
  }
  if (name === "write" || name === "edit") {
    return {
      tool: name,
      path: stringArg(args.path),
      workspace: process.cwd(),
    };
  }
  if (name === "remember_user") {
    return { tool: "remember_user", workspace: process.cwd() };
  }
  return null;
}

function describeAction(
  name: string,
  input: unknown,
  riskNote?: string,
): string {
  const args = asRecord(input);
  let base = "";

  if (name === "bash") {
    base = "Esto corre en tu máquina.";
  } else if (name === "web_fetch") {
    base = `Descargo ${stringArg(args.url) || "URL"} · puede salir data del repo`;
  } else if (name === "write") {
    const filePath = stringArg(args.path);
    const content = stringArg(args.content);
    const lines = content.split("\n").length;
    base = `${filePath} · ${lines} ${lines === 1 ? "línea" : "líneas"} · crea o sobrescribe`;
  } else if (name === "edit") {
    base = `${stringArg(args.path)} · cambia un bloque`;
  } else if (name === "remember_user") {
    const target = stringArg(args.target);
    const file =
      target === "soul"
        ? "soul.md"
        : target === "user"
          ? "user.md"
          : target === "behaviors"
            ? "behaviors.md"
            : "memoria global";
    base = `Guardo en ~/${CONFIG_DIR_NAME}/${file}`;
  } else if (name.startsWith("mcp__")) {
    base = `MCP ${name}`;
  }

  if (riskNote) {
    return base ? `${base} ${riskNote}` : riskNote;
  }
  return base;
}

async function askDecision(ask: AskFn): Promise<"allow" | "deny" | "allow_session"> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const raw = (await ask("  ¿Qué hago? ")).trim().toLowerCase();
    if (raw === "s" || raw === "si" || raw === "sí" || raw === "y" || raw === "yes") {
      return "allow";
    }
    if (raw === "n" || raw === "no") {
      return "deny";
    }
    if (raw === "a" || raw === "always" || raw === "siempre") {
      return "allow_session";
    }
  }
  return "deny";
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}
