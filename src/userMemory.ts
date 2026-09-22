import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR_NAME, configDir } from "./config.js";
import { estimateTokens } from "./tokens.js";

export type MemoryTarget = "soul" | "user" | "behaviors";

export type ProjectEntry = {
  path: string;
  name: string;
  gitRoot?: string;
  lastSeenAt: string;
  sessions: number;
};

type ProjectsFile = {
  projects: ProjectEntry[];
};

const MAX_BEHAVIORS_TOKENS = 1_200;
const MAX_SOUL_TOKENS = 1_500;
const MAX_USER_TOKENS = 2_000;

const TARGET_LIMIT: Record<MemoryTarget, number> = {
  behaviors: MAX_BEHAVIORS_TOKENS,
  soul: MAX_SOUL_TOKENS,
  user: MAX_USER_TOKENS,
};

const TARGET_FILE: Record<MemoryTarget, string> = {
  soul: "soul.md",
  user: "user.md",
  behaviors: "behaviors.md",
};

const TEMPLATES: Record<MemoryTarget, string> = {
  soul: `# Soul

Soy Quillami Code, agente de código local nacido en el Caribe colombiano.
Ayudo a programar en el repo donde me abren, con tools y permiso antes de tocar disco.
`,
  user: `# User

## Sobre mí

## Proyectos

## Preferencias
`,
  behaviors: `# Behaviors

- Responde en el idioma del usuario.
`,
};

export function userDir(): string {
  return configDir();
}

export function soulPath(): string {
  return path.join(userDir(), TARGET_FILE.soul);
}

export function userProfilePath(): string {
  return path.join(userDir(), TARGET_FILE.user);
}

export function behaviorsPath(): string {
  return path.join(userDir(), TARGET_FILE.behaviors);
}

export function projectsPath(): string {
  return path.join(userDir(), "projects.json");
}

export function pathForTarget(target: MemoryTarget): string {
  if (target === "soul") return soulPath();
  if (target === "user") return userProfilePath();
  return behaviorsPath();
}

export function labelForTarget(target: MemoryTarget): string {
  return TARGET_FILE[target];
}

function ensureUserDir(): void {
  const dir = userDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // ignore
  }
}

function secureFile(filePath: string): void {
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // ignore
  }
}

export function ensureTemplates(): void {
  ensureUserDir();
  for (const target of ["soul", "user", "behaviors"] as MemoryTarget[]) {
    const file = pathForTarget(target);
    if (existsSync(file)) continue;
    writeFileSync(file, TEMPLATES[target], { mode: 0o600 });
    secureFile(file);
  }
}

function truncateText(text: string, maxTokens: number): { text: string; truncated: boolean } {
  if (estimateTokens(text) <= maxTokens) {
    return { text, truncated: false };
  }
  const slice = text.slice(0, maxTokens * 4);
  return { text: `${slice}\n…(truncated)`, truncated: true };
}

function loadOne(filePath: string, label: string, maxTokens: number): string {
  if (!existsSync(filePath)) return "";
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return "";
  const { text, truncated } = truncateText(raw, maxTokens);
  const note = truncated ? " (truncated in prompt; full file on disk)" : "";
  return `### ${label}${note}\n${text}`;
}

export function loadGlobalMemory(): { body: string; truncated: boolean } {
  ensureTemplates();
  const parts: string[] = [];
  let truncated = false;

  const behaviors = loadOne(behaviorsPath(), "behaviors.md", MAX_BEHAVIORS_TOKENS);
  if (behaviors) parts.push(behaviors);
  const soul = loadOne(soulPath(), "soul.md", MAX_SOUL_TOKENS);
  if (soul) parts.push(soul);
  const user = loadOne(userProfilePath(), "user.md", MAX_USER_TOKENS);
  if (user) parts.push(user);

  for (const target of ["behaviors", "soul", "user"] as MemoryTarget[]) {
    const file = pathForTarget(target);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8").trim();
    if (raw && estimateTokens(raw) > TARGET_LIMIT[target]) {
      truncated = true;
    }
  }

  if (parts.length === 0) {
    return { body: "", truncated: false };
  }

  return {
    body: `Global memory (~/${CONFIG_DIR_NAME}):\n\n${parts.join("\n\n")}`,
    truncated,
  };
}

function findGitRoot(start: string): string | undefined {
  let current = path.resolve(start);
  for (let depth = 0; depth < 32; depth += 1) {
    if (existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function projectName(cwd: string): string {
  const pkg = path.join(cwd, "package.json");
  if (existsSync(pkg)) {
    try {
      const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
      if (typeof parsed.name === "string" && parsed.name.trim()) {
        return parsed.name.trim();
      }
    } catch {
      // ignore
    }
  }
  return path.basename(cwd);
}

export function touchProjectRegistry(cwd: string): void {
  ensureUserDir();
  const absolute = path.resolve(cwd);
  const gitRoot = findGitRoot(absolute);
  const now = new Date().toISOString();
  const file = projectsPath();

  let data: ProjectsFile = { projects: [] };
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, "utf8")) as ProjectsFile;
      if (!Array.isArray(data.projects)) {
        data.projects = [];
      }
    } catch {
      data = { projects: [] };
    }
  }

  const existing = data.projects.find((entry) => entry.path === absolute);
  if (existing) {
    existing.name = projectName(absolute);
    existing.gitRoot = gitRoot;
    existing.lastSeenAt = now;
    existing.sessions += 1;
  } else {
    data.projects.push({
      path: absolute,
      name: projectName(absolute),
      gitRoot,
      lastSeenAt: now,
      sessions: 1,
    });
  }

  data.projects.sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  );

  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  secureFile(file);
}

export function loadProjects(): ProjectEntry[] {
  const file = projectsPath();
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as ProjectsFile;
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

export function formatProjectsList(): string {
  const projects = loadProjects();
  if (projects.length === 0) {
    return "  (ninguno registrado aún)\n";
  }
  const lines = projects.map((entry) => {
    const when = entry.lastSeenAt.slice(0, 10);
    const sessions = entry.sessions === 1 ? "1 sesión" : `${entry.sessions} sesiones`;
    return `  ${when}  ${entry.name.padEnd(20)}  ${sessions}\n       ${entry.path}`;
  });
  return `${lines.join("\n")}\n`;
}

export function formatMemorySummary(previewLines = 12): string {
  ensureTemplates();
  const files: { label: string; file: string }[] = [
    { label: "soul", file: soulPath() },
    { label: "user", file: userProfilePath() },
    { label: "behaviors", file: behaviorsPath() },
  ];

  const parts: string[] = [`Memoria global (~/${CONFIG_DIR_NAME}):\n`];
  for (const { label, file } of files) {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    const lines = text.split("\n");
    const preview = lines.slice(0, previewLines).join("\n");
    const more = lines.length > previewLines ? `\n… (+${lines.length - previewLines} líneas)` : "";
    parts.push(`--- ${label}.md (${file}) ---\n${preview || "(vacío)"}${more}\n`);
  }
  return parts.join("\n");
}

export function readGlobalFile(target: MemoryTarget, maxLines = 200): string {
  ensureTemplates();
  const file = pathForTarget(target);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n… (archivo completo en ${file})\n`;
}

function parseTarget(value: unknown): MemoryTarget {
  if (value === "soul" || value === "user" || value === "behaviors") {
    return value;
  }
  throw new Error('target must be "soul", "user", or "behaviors"');
}

function parseMode(value: unknown): "append" | "replace_section" {
  if (value === "append" || value === "replace_section") {
    return value;
  }
  throw new Error('mode must be "append" or "replace_section"');
}

function replaceSection(content: string, heading: string, replacement: string): string {
  const normalized = heading.trim();
  if (!normalized.startsWith("#")) {
    throw new Error("heading must start with #");
  }
  const lines = content.split("\n");
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === normalized.toLowerCase(),
  );
  if (start === -1) {
    const sep = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${sep}\n${normalized}\n\n${replacement.trim()}\n`;
  }

  let end = lines.length;
  const level = normalized.match(/^#+/)?.[0].length ?? 2;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#+)\s+/);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }

  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  const next = [...before, "", replacement.trim(), "", ...after].join("\n");
  return next.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export async function rememberUser(input: Record<string, unknown>): Promise<string> {
  const target = parseTarget(input.target);
  const mode = parseMode(input.mode ?? "append");
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) {
    throw new Error("missing content");
  }

  ensureTemplates();
  const file = pathForTarget(target);
  let body = existsSync(file) ? readFileSync(file, "utf8") : TEMPLATES[target];

  if (mode === "replace_section") {
    const heading =
      typeof input.heading === "string" ? input.heading.trim() : "";
    if (!heading) {
      throw new Error("replace_section requires heading");
    }
    body = replaceSection(body, heading, content);
  } else {
    const stamp = new Date().toISOString().slice(0, 10);
    const block = `\n\n<!-- ${stamp} -->\n${content}\n`;
    body = body.trimEnd() + block;
  }

  await writeFile(file, body, { mode: 0o600 });
  secureFile(file);
  return `saved to ~/${CONFIG_DIR_NAME}/${TARGET_FILE[target]} (${mode})`;
}
