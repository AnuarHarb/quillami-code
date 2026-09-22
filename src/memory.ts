import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { estimateTokens } from "./tokens.js";

import {
  LEGACY_PROJECT_MEMORY_FILE,
  PROJECT_MEMORY_FILE,
} from "./config.js";

export const MEMORY_FILES = [
  PROJECT_MEMORY_FILE,
  "AGENTS.md",
  LEGACY_PROJECT_MEMORY_FILE,
] as const;

const MAX_MEMORY_TOKENS = 4_000;

export function listMemoryFiles(root = process.cwd()): string[] {
  return MEMORY_FILES.filter((name) => existsSync(path.join(root, name)));
}

export function loadProjectMemory(root = process.cwd()): string {
  const chunks: string[] = [];

  for (const name of listMemoryFiles(root)) {
    const full = path.join(root, name);
    let text = readFileSync(full, "utf8").trim();
    if (!text) continue;
    if (estimateTokens(text) > MAX_MEMORY_TOKENS) {
      text = `${text.slice(0, MAX_MEMORY_TOKENS * 4)}\n…(truncated)`;
    }
    chunks.push(`### ${name}\n${text}`);
  }

  return chunks.join("\n\n");
}
