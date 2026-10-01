import type { AgentMode } from "./mode.js";

export type CliCommand = "chat" | "doctor" | "sessions" | "mcp" | "models" | "setup";

export type CliArgs = {
  command: CliCommand;
  prompt?: string;
  /** Search text for `quillami models <texto>`. */
  query?: string;
  model?: string;
  mode: AgentMode;
  resume?: string;
  continueLast: boolean;
};

const SUBCOMMANDS = new Set<CliCommand>(["doctor", "sessions", "mcp", "models", "setup"]);

export function parseArgs(argv: string[]): CliArgs {
  let model: string | undefined;
  let mode: AgentMode = "agent";
  let resume: string | undefined;
  let continueLast = false;
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--model" || token === "-m") {
      model = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--resume") {
      resume = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--continue" || token === "-c") {
      continueLast = true;
      continue;
    }
    if (token === "--plan") {
      mode = "plan";
      continue;
    }
    if (token === "--yolo") {
      mode = "yolo";
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    positionals.push(token);
  }

  if (positionals.length > 0 && SUBCOMMANDS.has(positionals[0] as CliCommand)) {
    return {
      command: positionals[0] as CliCommand,
      query: positionals.slice(1).join(" ") || undefined,
      model,
      mode,
      resume,
      continueLast,
    };
  }

  if (positionals.length > 0) {
    return {
      command: "chat",
      prompt: positionals.join(" "),
      model,
      mode,
      resume,
      continueLast,
    };
  }

  return {
    command: "chat",
    model,
    mode,
    resume,
    continueLast,
  };
}
