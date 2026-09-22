import { homedir } from "node:os";
import path from "node:path";

export const APP_NAME = "Quillami Code";
export const CLI_NAME = "quillami";
export const CONFIG_DIR_NAME = ".quillami";
export const LEGACY_CONFIG_DIR_NAME = ".killami";
export const PROJECT_MEMORY_FILE = "QUILLAMI.md";
export const LEGACY_PROJECT_MEMORY_FILE = "KILLAMI.md";

export function configDir(): string {
  return path.join(homedir(), CONFIG_DIR_NAME);
}

export function legacyConfigDir(): string {
  return path.join(homedir(), LEGACY_CONFIG_DIR_NAME);
}
