import type Anthropic from "@anthropic-ai/sdk";
import type { AgentMode } from "./mode.js";
import type { McpToolBinding } from "./mcp.js";
import { findSkill, loadSkill, readSkillFile, type Skill } from "./skills.js";
import {
  BUILTIN_TOOL_DEFINITIONS,
  executeBuiltinTool,
  type ToolContext,
} from "./tools.js";

const PLAN_BLOCKED = new Set([
  "write",
  "edit",
  "bash",
  "remember_user",
  "web_fetch",
]);

const SKILL_TOOL: Anthropic.Tool = {
  name: "skill",
  description:
    "Load a skill's instructions by name (see the Skills list in the system prompt). Pass file to read one of the skill's supporting files, relative to its folder.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name from the Skills list" },
      file: { type: "string", description: "Optional supporting file, e.g. references/springs.md" },
    },
    required: ["name"],
  },
};

export type ToolRegistry = {
  definitions(mode: AgentMode): Anthropic.Tool[];
  execute(name: string, input: unknown, ctx?: ToolContext): Promise<string>;
  skills?: Skill[];
};

export function createToolRegistry(options?: {
  mcpTools?: McpToolBinding[];
  skills?: Skill[];
}): ToolRegistry {
  const mcp = options?.mcpTools ?? [];
  const mcpByName = new Map(mcp.map((tool) => [tool.exposedName, tool]));
  const skills = options?.skills ?? [];

  return {
    skills,

    definitions(mode) {
      const builtins = BUILTIN_TOOL_DEFINITIONS.filter((tool) => {
        if (mode !== "plan") return true;
        return !PLAN_BLOCKED.has(tool.name);
      });
      const skillDefs = skills.length > 0 ? [SKILL_TOOL] : [];
      const mcpDefs =
        mode === "plan"
          ? []
          : mcp.map((tool) => tool.definition);
      return [...builtins, ...skillDefs, ...mcpDefs];
    },

    async execute(name, input, ctx) {
      const mcpTool = mcpByName.get(name);
      if (mcpTool) {
        const args =
          input && typeof input === "object"
            ? (input as Record<string, unknown>)
            : {};
        return mcpTool.call(args, ctx?.signal);
      }
      if (name === SKILL_TOOL.name && skills.length > 0) {
        return runSkillTool(skills, input);
      }
      return executeBuiltinTool(name, input, ctx);
    },
  };
}

function runSkillTool(skills: Skill[], input: unknown): string {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = typeof args.name === "string" ? args.name : "";
  const skill = findSkill(skills, name);
  if (!skill) {
    throw new Error(`no skill named "${name}". Available: ${skills.map((entry) => entry.name).join(", ")}`);
  }
  return typeof args.file === "string" && args.file.trim()
    ? readSkillFile(skill, args.file.trim())
    : loadSkill(skill);
}

export function defaultToolRegistry(): ToolRegistry {
  return createToolRegistry();
}

export function isPlanBlockedTool(name: string): boolean {
  if (name.startsWith("mcp__")) return true;
  return PLAN_BLOCKED.has(name);
}
