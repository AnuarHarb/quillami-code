import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CONFIG_DIR_NAME, displayPath } from "./config.js";

export const SKILL_FILE = "SKILL.md";

/** Own folder first, then the ones other agents use, so existing skills work without copying. */
const SKILL_DIRS = [CONFIG_DIR_NAME, ".claude", ".agents", ".cursor"].map((dir) => path.join(dir, "skills"));

const MAX_SKILLS = 100;
const MAX_INDEX_DESCRIPTION = 400;
const MAX_SKILL_BYTES = 200_000;
const MAX_LISTED_FILES = 50;
const LIST_DEPTH = 3;

export type Skill = {
  name: string;
  description: string;
  /** Real path of the skill folder (symlinks resolved). */
  dir: string;
  /** Folder it was found in, for /skills and the banner. */
  root: string;
  /** Only the user can start it, with /name; the model does not see it in the index. */
  manualOnly: boolean;
};

export function skillRoots(cwd = process.cwd(), home = homedir()): string[] {
  return [...SKILL_DIRS.map((dir) => path.join(cwd, dir)), ...SKILL_DIRS.map((dir) => path.join(home, dir))];
}

/** First folder wins when two skills share a name, so a project can override a global skill. */
export function discoverSkills(roots = skillRoots()): Skill[] {
  const byName = new Map<string, Skill>();
  const seenDirs = new Set<string>();

  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const skill = readSkill(root, entry);
      if (!skill || seenDirs.has(skill.dir) || byName.has(skill.name)) continue;
      seenDirs.add(skill.dir);
      byName.set(skill.name, skill);
      if (byName.size >= MAX_SKILLS) return [...byName.values()];
    }
  }

  return [...byName.values()];
}

function readSkill(root: string, entry: string): Skill | null {
  try {
    const dir = realpathSync(path.join(root, entry));
    if (!statSync(dir).isDirectory()) return null;
    const meta = parseFrontmatter(readFileSync(path.join(dir, SKILL_FILE), "utf8")).meta;
    const description = meta.description?.trim();
    if (!description) return null;
    return {
      name: meta.name?.trim() || entry,
      description,
      dir,
      root,
      manualOnly: meta["disable-model-invocation"]?.trim() === "true",
    };
  } catch {
    return null;
  }
}

/** The small YAML subset skills use: `key: value`, quoted values, and `>` / `|` blocks. */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text };

  const meta: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const field = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!field) continue;
    const [, key, raw] = field;
    const block = /^([>|])[+-]?$/.exec(raw);
    if (!block) {
      meta[key] = unquote(raw.trim());
      continue;
    }
    const parts: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
      i += 1;
      parts.push(lines[i].trim());
    }
    meta[key] = block[1] === ">" ? parts.join(" ").replace(/\s+/g, " ").trim() : parts.join("\n").trim();
  }

  return { meta, body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    return value.slice(1, -1);
  }
  return value;
}

export function findSkill(skills: Skill[], name: string): Skill | undefined {
  const wanted = name.trim().toLowerCase();
  return skills.find((skill) => skill.name.toLowerCase() === wanted);
}

export function formatSkillIndex(skills: Skill[]): string {
  const visible = skills.filter((skill) => !skill.manualOnly);
  if (visible.length === 0) return "";
  const lines = visible.map((skill) => {
    const description =
      skill.description.length > MAX_INDEX_DESCRIPTION
        ? `${skill.description.slice(0, MAX_INDEX_DESCRIPTION - 1)}…`
        : skill.description;
    return `- ${skill.name}: ${description}`;
  });
  return [
    "Skills: packaged instructions for specific kinds of work. When a request matches a skill's description, call the skill tool with its name before starting, then follow what it says. Load a skill only when it applies.",
    ...lines,
  ].join("\n");
}

/** The skill's instructions plus its supporting files, which the model can then read with `file`. */
export function loadSkill(skill: Skill): string {
  const body = parseFrontmatter(readCapped(path.join(skill.dir, SKILL_FILE))).body.trim();
  const files = listSkillFiles(skill.dir);
  const parts = [`# Skill: ${skill.name}`, `Directory: ${skill.dir}`, body];
  if (files.length > 0) {
    parts.push(
      `Supporting files (read them with the skill tool and file="<path>"; scripts run with bash from the directory above):\n${files.map((file) => `- ${file}`).join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export function readSkillFile(skill: Skill, file: string): string {
  const outside = (target: string) => {
    const relative = path.relative(skill.dir, target);
    return relative.startsWith("..") || path.isAbsolute(relative);
  };
  const target = path.resolve(skill.dir, file);
  if (outside(target) || outside(realpathSync(target))) {
    throw new Error(`${file} is outside the ${skill.name} skill folder`);
  }
  return readCapped(target);
}

function readCapped(file: string): string {
  if (statSync(file).size > MAX_SKILL_BYTES) {
    throw new Error(`${path.basename(file)} is larger than ${MAX_SKILL_BYTES} bytes`);
  }
  return readFileSync(file, "utf8");
}

function listSkillFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_LISTED_FILES) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < LIST_DEPTH) walk(full, depth + 1);
      } else if (!(depth === 0 && entry.name === SKILL_FILE)) {
        files.push(path.relative(dir, full));
      }
    }
  };
  walk(dir, 0);
  return files;
}

/** `/name request` → the message the model gets, or null when no skill has that name. */
export function expandSkillCommand(input: string, skills: Skill[]): string | null {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(input);
  const skill = match ? findSkill(skills, match[1]) : undefined;
  return skill ? skillInvocationMessage(skill, match![2].trim()) : null;
}

/** What the user typed after `/name` becomes the request; the skill itself goes in front. */
export function skillInvocationMessage(skill: Skill, request: string): string {
  return [
    `The user started the "${skill.name}" skill. Follow it for this request.`,
    loadSkill(skill),
    `Request: ${request || "(none given; start as the skill says)"}`,
  ].join("\n\n");
}

export function formatSkillsList(skills: Skill[], roots = skillRoots()): string {
  if (skills.length === 0) {
    const where = [...new Set(roots.map(displayPath))].join(", ");
    return `   skills: ninguna. Pon carpetas con ${SKILL_FILE} en ${where}.`;
  }
  const width = Math.max(...skills.map((skill) => skill.name.length));
  const lines = skills.map((skill) => {
    const tag = skill.manualOnly ? " (solo con /" + skill.name + ")" : "";
    const summary = skill.description.length > 90 ? `${skill.description.slice(0, 89)}…` : skill.description;
    return `   ${skill.name.padEnd(width)}  ${summary}${tag}`;
  });
  const sources = [...new Set(skills.map((skill) => displayPath(skill.root)))].join(", ");
  return [
    `   skills: ${skills.length} (${sources})`,
    "",
    ...lines,
    "",
    "   El modelo carga la que aplique según tu pedido. Para forzar una: /nombre lo que quieres.",
  ].join("\n");
}

export function skillsBannerLine(skills: Skill[]): string {
  if (skills.length === 0) return `skills: ninguna (~/${CONFIG_DIR_NAME}/skills, /skills)`;
  const sources = [...new Set(skills.map((skill) => displayPath(skill.root)))].join(", ");
  return `skills: ${skills.length} (${sources}) · /skills`;
}
