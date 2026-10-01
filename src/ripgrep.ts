import { spawn } from "node:child_process";

export type RipgrepOptions = {
  cwd: string;
  maxHits: number;
  maxLineChars: number;
  maxFileBytes: number;
  ignoreDirs: string[];
  signal?: AbortSignal;
  binary?: string;
};

export type RipgrepResult = { hits: string[]; truncated: boolean };

let missing = false;

export function ripgrepDisabled(): boolean {
  return missing || process.env.QUILLAMI_RG?.trim().toLowerCase() === "off";
}

/**
 * Returns null when the caller should fall back to the JavaScript search:
 * rg is not installed, or it rejected the pattern (rg has no lookaround or
 * backreferences, which JavaScript regexes support).
 */
export function ripgrepSearch(
  pattern: string,
  target: string,
  options: RipgrepOptions,
): Promise<RipgrepResult | null> {
  if (ripgrepDisabled() && !options.binary) return Promise.resolve(null);

  const args = [
    "--line-number",
    "--no-heading",
    "--with-filename",
    "--color",
    "never",
    "--hidden",
    "--sort",
    "path",
    "--max-filesize",
    String(options.maxFileBytes),
    ...options.ignoreDirs.flatMap((dir) => ["--glob", `!${dir}`]),
    "--regexp",
    pattern,
    "--",
    target,
  ];

  return new Promise((resolve) => {
    const child = spawn(options.binary ?? "rg", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    const hits: string[] = [];
    let truncated = false;
    let pending = "";

    const takeLine = (line: string) => {
      if (truncated || !line) return;
      if (hits.length >= options.maxHits) {
        truncated = true;
        child.kill();
        return;
      }
      const clean = line.startsWith("./") ? line.slice(2) : line;
      hits.push(
        clean.length > options.maxLineChars
          ? `${clean.slice(0, options.maxLineChars)} ...`
          : clean,
      );
    };

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) takeLine(line);
    });
    child.stderr.resume();

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && !options.binary) missing = true;
      resolve(null);
    });
    child.on("close", (code) => {
      takeLine(pending);
      if (truncated || code === 0 || code === 1) {
        resolve({ hits, truncated });
      } else if (hits.length > 0) {
        resolve({ hits, truncated: false });
      } else {
        resolve(null);
      }
    });
  });
}
