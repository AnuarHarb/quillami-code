import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { configDir, legacyConfigDir } from "./config.js";

export function userEnvPath(): string {
  return path.join(configDir(), ".env");
}

export function projectEnvPath(): string {
  return path.resolve(process.cwd(), ".env");
}

/** Variable names defined in an env file (values are never read out). */
export function envFileKeys(envPath: string): Set<string> {
  const keys = new Set<string>();
  if (!existsSync(envPath)) return keys;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && value) keys.add(key);
  }
  return keys;
}

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadEnv(): void {
  loadEnvFile(projectEnvPath());
  loadEnvFile(path.join(configDir(), ".env"));
  loadEnvFile(path.join(legacyConfigDir(), ".env"));
}
