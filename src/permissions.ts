import { dim } from "./banner.js";
import { CONFIG_DIR_NAME } from "./config.js";

const RISKY_TOOLS = new Set(["write", "edit", "bash", "remember_user"]);

export type AskFn = (prompt: string) => Promise<string>;

export type PermissionGate = {
  authorize(name: string, input: unknown): Promise<boolean>;
};

export function createGate(ask: AskFn): PermissionGate {
  let allowSession = false;

  return {
    async authorize(name, input) {
      if (!RISKY_TOOLS.has(name) || allowSession) {
        return true;
      }

      const detail = describeAction(name, input);
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
        return false;
      }
      if (decision === "allow_session") {
        allowSession = true;
        process.stdout.write(`${dim("  Va, esta sesión no pregunto más.")}\n`);
      }
      return true;
    },
  };
}

function describeAction(name: string, input: unknown): string {
  const args = asRecord(input);

  if (name === "bash") {
    return "Esto corre en tu máquina.";
  }

  if (name === "write") {
    const filePath = stringArg(args.path);
    const content = stringArg(args.content);
    const lines = content.split("\n").length;
    return `${filePath} · ${lines} ${lines === 1 ? "línea" : "líneas"} · crea o sobrescribe`;
  }

  if (name === "edit") {
    return `${stringArg(args.path)} · cambia un bloque`;
  }

  if (name === "remember_user") {
    const target = stringArg(args.target);
    const file =
      target === "soul"
        ? "soul.md"
        : target === "user"
          ? "user.md"
          : target === "behaviors"
            ? "behaviors.md"
            : "memoria global";
    return `Guardo en ~/${CONFIG_DIR_NAME}/${file}`;
  }

  return "";
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
