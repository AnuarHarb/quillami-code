import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { dim } from "./banner.js";
import { userEnvPath } from "./env.js";
import {
  hasKey,
  keyEnvFor,
  keyHelpUrl,
  providerLabel,
  type Provider,
} from "./providers.js";

export { hasKey };

export async function promptAndSaveKey(provider: Provider): Promise<boolean> {
  const envVar = keyEnvFor(provider);
  const label = providerLabel(provider);
  const url = keyHelpUrl(provider);

  console.log(
    `\n${label} necesita una API key (${url}).\n` +
      "Pégala aquí. No se ve en pantalla.\n" +
      `La guardo en ${userEnvPath()}\n`,
  );

  let value: string;
  try {
    value = (await readHidden(`${label} API key: `)).trim();
  } catch {
    console.log(dim("\n   Cancelado.\n"));
    return false;
  }

  if (!value) {
    console.log(dim("\n   No pegaste nada.\n"));
    return false;
  }

  saveUserKey(envVar, value);
  process.env[envVar] = value;
  console.log(dim("\n   Listo, guardada.\n"));
  return true;
}

export function saveUserKey(envVar: string, value: string, file = userEnvPath()): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // ignore
  }

  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key === envVar) {
      found = true;
      return `${envVar}=${value}`;
    }
    return line;
  });

  if (!found) {
    if (next.length > 0 && next[next.length - 1] !== "") {
      next.push("");
    }
    next.push(`${envVar}=${value}`);
  }

  const body = next.join("\n").replace(/\n+$/, "") + "\n";
  writeFileSync(file, body, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // ignore
  }
}

export async function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  if (!stdin.isTTY) {
    throw new Error("stdin is not a TTY");
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let value = "";

  return await new Promise((resolve, reject) => {
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          stdout.write("\n");
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (char < " " && char !== "\t") {
          continue;
        }
        value += char;
        stdout.write("*");
      }
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    stdin.on("data", onData);
  });
}
