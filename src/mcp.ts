import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type Anthropic from "@anthropic-ai/sdk";
import { configDir } from "./config.js";

const CONNECT_TIMEOUT_MS = 10_000;
const MCP_PREFIX = "mcp__";

export type McpServerConfig = {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  tools?: string[];
};

export type McpConfigFile = {
  servers?: Record<string, McpServerConfig>;
};

export type McpToolBinding = {
  exposedName: string;
  serverName: string;
  toolName: string;
  definition: Anthropic.Tool;
  call: (input: Record<string, unknown>) => Promise<string>;
};

export type McpRuntime = {
  tools: McpToolBinding[];
  bannerLine(): string;
  formatList(): string;
  close(): Promise<void>;
};

export function mcpConfigPath(): string {
  return path.join(configDir(), "mcp.json");
}

export function loadMcpConfigFile(): McpConfigFile {
  const file = mcpConfigPath();
  if (!existsSync(file)) return { servers: {} };
  try {
    return JSON.parse(readFileSync(file, "utf8")) as McpConfigFile;
  } catch {
    return { servers: {} };
  }
}

export function expandEnvTemplate(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    return process.env[name] ?? "";
  });
}

export function expandEnvInRecord(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return undefined;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    next[key] = expandEnvTemplate(value);
  }
  return next;
}

export function mcpExposedName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${MCP_PREFIX}${safeServer}__${safeTool}`;
}

export function parseMcpExposedName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const split = rest.indexOf("__");
  if (split === -1) return null;
  return {
    server: rest.slice(0, split),
    tool: rest.slice(split + 2),
  };
}

export function filterMcpTools(
  serverName: string,
  toolNames: string[],
  allowList: string[] | undefined,
): string[] {
  if (!allowList || allowList.length === 0) return toolNames;
  return toolNames.filter((tool) => allowList.includes(tool));
}

export async function connectMcpServers(
  onError?: (message: string) => void,
): Promise<McpRuntime> {
  const config = loadMcpConfigFile();
  const servers = config.servers ?? {};
  const bindings: McpToolBinding[] = [];
  const clients: Client[] = [];
  const summaries: { name: string; count: number }[] = [];

  const entries = Object.entries(servers).filter(([, cfg]) => cfg.enabled !== false);

  await Promise.all(
    entries.map(async ([serverName, cfg]) => {
      try {
        const connected = await withTimeout(
          connectOneServer(serverName, cfg),
          CONNECT_TIMEOUT_MS,
          `mcp ${serverName}`,
        );
        clients.push(connected.client);
        const toolNames = connected.tools.map((tool) => tool.name);
        const filtered = filterMcpTools(serverName, toolNames, cfg.tools);
        for (const tool of connected.tools) {
          if (!filtered.includes(tool.name)) continue;
          const exposedName = mcpExposedName(serverName, tool.name);
          bindings.push({
            exposedName,
            serverName,
            toolName: tool.name,
            definition: {
              name: exposedName,
              description: tool.description ?? `MCP ${serverName}/${tool.name}`,
              input_schema: (tool.inputSchema ?? {
                type: "object",
                properties: {},
              }) as Anthropic.Tool.InputSchema,
            },
            call: async (input) => {
              const result = await connected.client.callTool({
                name: tool.name,
                arguments: input,
              });
              return formatToolResult(result);
            },
          });
        }
        summaries.push({ name: serverName, count: filtered.length });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        onError?.(`mcp ${serverName}: ${message}`);
      }
    }),
  );

  return {
    tools: bindings,
    bannerLine() {
      if (summaries.length === 0) return "mcp: ninguno";
      return `mcp: ${summaries.map((s) => `${s.name} (${s.count})`).join(", ")}`;
    },
    formatList() {
      if (bindings.length === 0) {
        return "  (sin servidores MCP conectados; configura ~/.quillami/mcp.json)";
      }
      const lines = summaries.map((s) => `  ${s.name}: ${s.count} tools`);
      for (const binding of bindings) {
        lines.push(`    ${binding.exposedName}`);
      }
      return lines.join("\n");
    },
    async close() {
      await Promise.all(
        clients.map(async (client) => {
          try {
            await client.close();
          } catch {
            // ignore
          }
        }),
      );
    },
  };
}

async function connectOneServer(
  serverName: string,
  cfg: McpServerConfig,
): Promise<{ client: Client; tools: { name: string; description?: string; inputSchema?: unknown }[] }> {
  const client = new Client({ name: "quillami", version: "0.2.0" });
  let transport;

  if (cfg.url) {
    const headers = expandEnvInRecord(cfg.headers);
    transport = new StreamableHTTPClientTransport(new URL(expandEnvTemplate(cfg.url)), {
      requestInit: headers ? { headers } : undefined,
    });
  } else if (cfg.command) {
    transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args,
      env: expandEnvInRecord(cfg.env),
      stderr: "pipe",
    });
  } else {
    throw new Error("server needs url or command");
  }

  await client.connect(transport);
  const listed = await client.listTools();
  const tools = listed.tools ?? [];
  if (tools.length === 0) {
    throw new Error("no tools reported");
  }
  return { client, tools };
}

function formatToolResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result);
  }
  const record = result as {
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };
  const parts: string[] = [];
  for (const block of record.content ?? []) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    } else {
      parts.push(`[${block.type} content omitted]`);
    }
  }
  const body = parts.join("\n") || "(empty tool result)";
  return record.isError ? `Error: ${body}` : body;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
