import type Anthropic from "@anthropic-ai/sdk";
import type { AgentMode } from "./mode.js";
import type { McpToolBinding } from "./mcp.js";
import { BUILTIN_TOOL_DEFINITIONS, executeBuiltinTool } from "./tools.js";

const PLAN_BLOCKED = new Set([
  "write",
  "edit",
  "bash",
  "remember_user",
  "web_fetch",
]);

export type ToolRegistry = {
  definitions(mode: AgentMode): Anthropic.Tool[];
  execute(name: string, input: unknown): Promise<string>;
};

export function createToolRegistry(options?: {
  mcpTools?: McpToolBinding[];
}): ToolRegistry {
  const mcp = options?.mcpTools ?? [];
  const mcpByName = new Map(mcp.map((tool) => [tool.exposedName, tool]));

  return {
    definitions(mode) {
      const builtins = BUILTIN_TOOL_DEFINITIONS.filter((tool) => {
        if (mode !== "plan") return true;
        return !PLAN_BLOCKED.has(tool.name);
      });
      const mcpDefs =
        mode === "plan"
          ? []
          : mcp.map((tool) => tool.definition);
      return [...builtins, ...mcpDefs];
    },

    async execute(name, input) {
      const mcpTool = mcpByName.get(name);
      if (mcpTool) {
        const args =
          input && typeof input === "object"
            ? (input as Record<string, unknown>)
            : {};
        return mcpTool.call(args);
      }
      return executeBuiltinTool(name, input);
    },
  };
}

export function defaultToolRegistry(): ToolRegistry {
  return createToolRegistry();
}

export function isPlanBlockedTool(name: string): boolean {
  if (name.startsWith("mcp__")) return true;
  return PLAN_BLOCKED.has(name);
}
