import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR_NAME } from "./config.js";
import { fetchPublicUrl } from "./webFetch.js";
import { rememberUser } from "./userMemory.js";

const execFileAsync = promisify(execFile);

const IGNORE = new Set(["node_modules", ".git", "dist"]);
export const MAX_FILE_BYTES = 200_000;
const MAX_GREP_HITS = 50;

export const BUILTIN_TOOL_DEFINITIONS = [
  {
    name: "read",
    description:
      "Read a UTF-8 text file. Paths are relative to the workspace root. Output includes line numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to the workspace" },
      },
      required: ["path"],
    },
  },
  {
    name: "write",
    description:
      "Create or overwrite a file. Creates parent directories if needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to the workspace" },
        content: { type: "string", description: "Full file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit",
    description:
      "Replace exactly one occurrence of old_string with new_string in a file. The old string must match exactly once.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to the workspace" },
        old_string: { type: "string", description: "Exact text to find" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "bash",
    description:
      "Run a shell command in the workspace root. Returns stdout and stderr.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Shell command to run" },
      },
      required: ["command"],
    },
  },
  {
    name: "grep",
    description:
      "Search file contents with a JavaScript regular expression. Optional path limits the search.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression" },
        path: {
          type: "string",
          description: "File or directory relative to the workspace. Defaults to the workspace root.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "glob",
    description: 'Find files matching a glob pattern such as "**/*.ts".',
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "Glob pattern relative to the workspace" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "ls",
    description: "List files and directories at a path. Defaults to the workspace root.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to the workspace",
        },
      },
    },
  },
  {
    name: "web_fetch",
    description:
      "Fetch a public http or https URL and return text (HTML is stripped). Local and private network URLs are blocked.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "Public http or https URL" },
        max_chars: {
          type: "number",
          description: "Maximum characters to return (default 20000)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "remember_user",
    description:
      `Save durable notes to the user's global ~/${CONFIG_DIR_NAME} memory (not the repo). ` +
      "soul = Quillami's identity; user = facts about the human; behaviors = how to interact. " +
      "Never store API keys or secrets.",
    input_schema: {
      type: "object" as const,
      properties: {
        target: {
          type: "string",
          enum: ["soul", "user", "behaviors"],
          description: "Which global file to update",
        },
        mode: {
          type: "string",
          enum: ["append", "replace_section"],
          description: "append adds text; replace_section replaces under heading",
        },
        heading: {
          type: "string",
          description: 'Required for replace_section, e.g. "## Preferencias"',
        },
        content: { type: "string", description: "Markdown to save" },
      },
      required: ["target", "content"],
    },
  },
];

function workspaceRoot(): string {
  return process.cwd();
}

export function resolveInWorkspace(relativePath: string): string {
  const root = workspaceRoot();
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path is outside the workspace: ${relativePath}`);
  }
  return absolute;
}

function shouldIgnore(name: string): boolean {
  return IGNORE.has(name);
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }

  return files;
}

async function readText(filePath: string): Promise<string> {
  const info = await stat(filePath);
  if (info.size > MAX_FILE_BYTES) {
    throw new Error(`file is larger than ${MAX_FILE_BYTES} bytes`);
  }
  return readFile(filePath, "utf8");
}

function withLineNumbers(content: string): string {
  return content
    .split("\n")
    .map((line, index) => `${String(index + 1).padStart(4, " ")}|${line}`)
    .join("\n");
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${field}`);
  }
  return value;
}

async function toolRead(input: Record<string, unknown>): Promise<string> {
  const filePath = resolveInWorkspace(asString(input.path, "path"));
  return withLineNumbers(await readText(filePath));
}

async function toolWrite(input: Record<string, unknown>): Promise<string> {
  const filePath = resolveInWorkspace(asString(input.path, "path"));
  const content = asString(input.content, "content");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return `wrote ${path.relative(workspaceRoot(), filePath)}`;
}

async function toolEdit(input: Record<string, unknown>): Promise<string> {
  const filePath = resolveInWorkspace(asString(input.path, "path"));
  const oldString = asString(input.old_string, "old_string");
  const newString = asString(input.new_string, "new_string");
  const content = await readText(filePath);
  const matches = content.split(oldString).length - 1;
  if (matches === 0) {
    throw new Error("old_string was not found");
  }
  if (matches > 1) {
    throw new Error(`old_string matched ${matches} times; it must match exactly once`);
  }
  await writeFile(filePath, applyEdit(content, oldString, newString), "utf8");
  return `edited ${path.relative(workspaceRoot(), filePath)}`;
}

/** A function replacer keeps `$&`, `$1`, and `$$` in new_string literal. */
export function applyEdit(content: string, oldString: string, newString: string): string {
  return content.replace(oldString, () => newString);
}

async function toolBash(input: Record<string, unknown>): Promise<string> {
  const command = asString(input.command, "command");
  try {
    const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
      cwd: workspaceRoot(),
      timeout: 30_000,
      maxBuffer: 1_000_000,
    });
    return formatProcessOutput(stdout, stderr, 0);
  } catch (error) {
    if (isExecError(error)) {
      return formatProcessOutput(error.stdout, error.stderr, error.code ?? 1);
    }
    throw error;
  }
}

function formatProcessOutput(
  stdout: string | undefined,
  stderr: string | undefined,
  exitCode: string | number,
): string {
  const parts = [
    `exit ${exitCode}`,
    stdout?.trim() ? `stdout:\n${stdout}` : "",
    stderr?.trim() ? `stderr:\n${stderr}` : "",
  ];
  return parts.filter(Boolean).join("\n\n") || `exit ${exitCode}`;
}

function isExecError(
  error: unknown,
): error is { stdout?: string; stderr?: string; code?: string | number } {
  return typeof error === "object" && error !== null;
}

async function toolGrep(input: Record<string, unknown>): Promise<string> {
  const pattern = asString(input.pattern, "pattern");
  const relativePath = typeof input.path === "string" ? input.path : ".";
  const regex = new RegExp(pattern);
  const target = resolveInWorkspace(relativePath);
  const info = await stat(target);
  const files = info.isFile() ? [target] : await walkFiles(target);
  const hits: string[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readText(file);
    } catch {
      continue;
    }

    const relative = path.relative(workspaceRoot(), file);
    for (const [index, line] of content.split("\n").entries()) {
      if (!regex.test(line)) continue;
      hits.push(`${relative}:${index + 1}:${line}`);
      if (hits.length >= MAX_GREP_HITS) {
        hits.push(`(stopped at ${MAX_GREP_HITS} matches)`);
        return hits.join("\n");
      }
    }
  }

  return hits.length > 0 ? hits.join("\n") : "no matches";
}

async function toolGlob(input: Record<string, unknown>): Promise<string> {
  const pattern = asString(input.pattern, "pattern");
  const matches: string[] = [];

  for await (const entry of fsGlob(pattern)) {
    if (entry.split(path.sep).some((part) => shouldIgnore(part))) continue;
    matches.push(entry);
    if (matches.length >= 200) {
      matches.push("(stopped at 200 matches)");
      break;
    }
  }

  return matches.length > 0 ? matches.join("\n") : "no matches";
}

async function* fsGlob(pattern: string): AsyncGenerator<string> {
  const { glob } = await import("node:fs/promises");
  for await (const entry of glob(pattern, { cwd: workspaceRoot() })) {
    yield entry;
  }
}

async function toolLs(input: Record<string, unknown>): Promise<string> {
  const relativePath = typeof input.path === "string" ? input.path : ".";
  const dir = resolveInWorkspace(relativePath);
  const entries = await readdir(dir, { withFileTypes: true });
  const lines = entries
    .filter((entry) => !shouldIgnore(entry.name))
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
    .sort();
  return lines.length > 0 ? lines.join("\n") : "(empty)";
}

async function toolRememberUser(input: Record<string, unknown>): Promise<string> {
  return rememberUser(input);
}

async function toolWebFetch(input: Record<string, unknown>): Promise<string> {
  const url = asString(input.url, "url");
  const maxChars =
    typeof input.max_chars === "number" && Number.isFinite(input.max_chars)
      ? input.max_chars
      : undefined;
  return fetchPublicUrl(url, { maxChars });
}

const handlers: Record<string, (input: Record<string, unknown>) => Promise<string>> = {
  read: toolRead,
  write: toolWrite,
  edit: toolEdit,
  bash: toolBash,
  grep: toolGrep,
  glob: toolGlob,
  ls: toolLs,
  web_fetch: toolWebFetch,
  remember_user: toolRememberUser,
};

/** @deprecated use executeBuiltinTool or ToolRegistry */
export const TOOL_DEFINITIONS = BUILTIN_TOOL_DEFINITIONS;

export async function executeBuiltinTool(
  name: string,
  input: unknown,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`unknown tool: ${name}`);
  }
  const args =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return handler(args);
}

export async function executeTool(
  name: string,
  input: unknown,
): Promise<string> {
  return executeBuiltinTool(name, input);
}
