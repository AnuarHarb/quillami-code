import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR_NAME } from "./config.js";
import { ripgrepSearch } from "./ripgrep.js";
import { HeadTailBuffer, MAX_TOOL_OUTPUT_CHARS } from "./truncate.js";
import { fetchPublicUrl } from "./webFetch.js";
import { rememberUser } from "./userMemory.js";

const IGNORE = new Set(["node_modules", ".git", "dist"]);
export const MAX_FILE_BYTES = 200_000;
const MAX_GREP_HITS = 50;
const MAX_GREP_LINE_CHARS = 300;
const READ_MAX_BYTES = 5_000_000;
const READ_DEFAULT_LIMIT = 2000;
const READ_MAX_LINE_CHARS = 2000;
export const BASH_DEFAULT_TIMEOUT_S = 120;
export const BASH_MAX_TIMEOUT_S = 1800;
const BASH_KILL_GRACE_MS = 2000;
const BASH_KEEP_CHARS = 12_000;

export type ToolContext = {
  signal?: AbortSignal;
  /** Raw stdout/stderr chunks from bash while it runs, for live display. */
  onOutput?: (chunk: string) => void;
};

type ToolHandler = (input: Record<string, unknown>, ctx?: ToolContext) => Promise<string>;

export const BUILTIN_TOOL_DEFINITIONS = [
  {
    name: "read",
    description:
      `Read a UTF-8 text file. Paths are relative to the workspace root. Output includes line numbers. Returns at most ${READ_DEFAULT_LIMIT} lines per call; use offset and limit to page through large files.`,
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to the workspace" },
        offset: {
          type: "number",
          description: "1-based line to start from (default 1)",
        },
        limit: {
          type: "number",
          description: `Maximum lines to return (default ${READ_DEFAULT_LIMIT})`,
        },
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
      `Run a shell command in the workspace root. Returns stdout and stderr. Stops after timeout_seconds (default ${BASH_DEFAULT_TIMEOUT_S}). Raise it for installs, builds, or long test suites. Long output keeps only its start and end, so pipe through head, tail, or grep when you need a specific part.`,
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Shell command to run" },
        timeout_seconds: {
          type: "number",
          description: `Seconds before the command is stopped (default ${BASH_DEFAULT_TIMEOUT_S}, max ${BASH_MAX_TIMEOUT_S})`,
        },
      },
      required: ["command"],
    },
  },
  {
    name: "grep",
    description:
      `Search file contents with a regular expression. Uses ripgrep when installed (respects .gitignore), otherwise a slower built-in search. Returns path:line:text, at most ${MAX_GREP_HITS} matches. Optional path limits the search.`,
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "Regular expression" },
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

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : undefined;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${field}`);
  }
  return value;
}

async function toolRead(input: Record<string, unknown>): Promise<string> {
  const filePath = resolveInWorkspace(asString(input.path, "path"));
  const info = await stat(filePath);
  if (info.size > READ_MAX_BYTES) {
    throw new Error(`file is larger than ${READ_MAX_BYTES} bytes; use grep or bash with head/tail`);
  }
  const lines = (await readFile(filePath, "utf8")).split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const offset = positiveInt(input.offset) ?? 1;
  const limit = positiveInt(input.limit) ?? READ_DEFAULT_LIMIT;
  if (offset > lines.length) {
    throw new Error(`offset ${offset} is past the end of the file (${lines.length} lines)`);
  }

  const end = Math.min(lines.length, offset - 1 + limit);
  const rows: string[] = [];
  let chars = 0;
  let lastShown = offset - 1;
  for (let index = offset - 1; index < end; index += 1) {
    const line = lines[index];
    const shown =
      line.length > READ_MAX_LINE_CHARS
        ? `${line.slice(0, READ_MAX_LINE_CHARS)} ... [line cut, ${line.length} characters]`
        : line;
    const row = `${String(index + 1).padStart(4, " ")}|${shown}`;
    if (rows.length > 0 && chars + row.length > MAX_TOOL_OUTPUT_CHARS) break;
    rows.push(row);
    chars += row.length + 1;
    lastShown = index + 1;
  }

  const body = rows.join("\n");
  if (lastShown >= lines.length && offset === 1) return body;
  const more =
    lastShown < lines.length ? `; call read with offset=${lastShown + 1} to continue` : "";
  return `${body}\n\n(lines ${offset}-${lastShown} of ${lines.length}${more})`;
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

export function bashTimeoutSeconds(input: Record<string, unknown>): number {
  const requested = positiveInt(input.timeout_seconds);
  return Math.min(requested ?? BASH_DEFAULT_TIMEOUT_S, BASH_MAX_TIMEOUT_S);
}

async function toolBash(input: Record<string, unknown>, ctx?: ToolContext): Promise<string> {
  const command = asString(input.command, "command");
  const signal = ctx?.signal;
  const timeoutSeconds = bashTimeoutSeconds(input);
  signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    // Own process group, so a timeout or Ctrl+C also stops grandchildren (npm → node → ...).
    const child = spawn("sh", ["-c", command], {
      cwd: workspaceRoot(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = new HeadTailBuffer(BASH_KEEP_CHARS);
    const stderr = new HeadTailBuffer(BASH_KEEP_CHARS);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout.push(chunk);
      ctx?.onOutput?.(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr.push(chunk);
      ctx?.onOutput?.(chunk);
    });

    let stopReason: "timeout" | "cancelled" | null = null;
    const killGroup = (killSignal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, killSignal);
      } catch {
        // Already exited.
      }
    };
    const stop = (reason: "timeout" | "cancelled") => {
      stopReason = reason;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), BASH_KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(() => stop("timeout"), timeoutSeconds * 1000);
    const onAbort = () => stop("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code, killedBy) => {
      cleanup();
      const exit = code ?? (killedBy ? `signal ${killedBy}` : 1);
      const note =
        stopReason === "timeout"
          ? `stopped after ${timeoutSeconds}s timeout; retry with a higher timeout_seconds if it needs longer`
          : stopReason === "cancelled"
            ? "stopped: the user cancelled the turn"
            : "";
      resolve(formatProcessOutput(stdout.toString(), stderr.toString(), exit, note));
    });
  });
}

function formatProcessOutput(
  stdout: string,
  stderr: string,
  exitCode: string | number,
  note: string,
): string {
  const parts = [
    `exit ${exitCode}`,
    note,
    stdout.trim() ? `stdout:\n${stdout}` : "",
    stderr.trim() ? `stderr:\n${stderr}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

async function toolGrep(input: Record<string, unknown>, ctx?: ToolContext): Promise<string> {
  const pattern = asString(input.pattern, "pattern");
  const relativePath = typeof input.path === "string" ? input.path : ".";
  const target = resolveInWorkspace(relativePath);
  await stat(target);

  const fast = await ripgrepSearch(pattern, path.relative(workspaceRoot(), target) || ".", {
    cwd: workspaceRoot(),
    maxHits: MAX_GREP_HITS,
    maxLineChars: MAX_GREP_LINE_CHARS,
    maxFileBytes: MAX_FILE_BYTES,
    ignoreDirs: [...IGNORE],
    signal: ctx?.signal,
  });
  ctx?.signal?.throwIfAborted();
  if (fast) {
    if (fast.hits.length === 0) return "no matches";
    const lines = [...fast.hits];
    if (fast.truncated) lines.push(`(stopped at ${MAX_GREP_HITS} matches)`);
    return lines.join("\n");
  }
  return grepWithWalk(pattern, target);
}

export async function grepWithWalk(pattern: string, target: string): Promise<string> {
  const regex = new RegExp(pattern);
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
      const shown =
        line.length > MAX_GREP_LINE_CHARS ? `${line.slice(0, MAX_GREP_LINE_CHARS)} ...` : line;
      hits.push(`${relative}:${index + 1}:${shown}`);
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

async function toolWebFetch(
  input: Record<string, unknown>,
  ctx?: ToolContext,
): Promise<string> {
  const signal = ctx?.signal;
  const url = asString(input.url, "url");
  const maxChars =
    typeof input.max_chars === "number" && Number.isFinite(input.max_chars)
      ? input.max_chars
      : undefined;
  return fetchPublicUrl(url, { maxChars, signal });
}

const handlers: Record<string, ToolHandler> = {
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
  ctx?: ToolContext,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`unknown tool: ${name}`);
  }
  const args =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return handler(args, ctx);
}

export async function executeTool(
  name: string,
  input: unknown,
): Promise<string> {
  return executeBuiltinTool(name, input);
}
