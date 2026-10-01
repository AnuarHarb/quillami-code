import { dim } from "./banner.js";

const ANSI_ESCAPE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const DEFAULT_WINDOW_LINES = 6;
const DEFAULT_THROTTLE_MS = 80;

export type LiveTailOptions = {
  write?: (text: string) => void;
  columns?: () => number;
  windowLines?: number;
  throttleMs?: number;
};

export type LiveTail = {
  push(chunk: string): void;
  /** Erases the live window; returns how many output lines were seen. */
  stop(): number;
};

/**
 * Shows the last few lines of a running command in place. Lines are cut to the
 * terminal width because a wrapped line would break the cursor-up redraw.
 */
export function createLiveTail(options: LiveTailOptions = {}): LiveTail {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const columns = options.columns ?? (() => process.stdout.columns || 80);
  const windowLines = options.windowLines ?? DEFAULT_WINDOW_LINES;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;

  const recent: string[] = [];
  let partial = "";
  let totalLines = 0;
  let drawn = 0;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const erase = () => {
    if (drawn > 0) write(`\x1b[${drawn}F\x1b[0J`);
    drawn = 0;
  };

  const render = () => {
    timer = null;
    if (stopped) return;
    const current = lastSegment(partial);
    const lines = [...recent, ...(current ? [current] : [])].slice(-windowLines);
    erase();
    const width = Math.max(10, columns() - 6);
    for (const line of lines) {
      const cut = line.length > width ? `${line.slice(0, width - 1)}…` : line;
      write(`${dim(`  │ ${cut}`)}\n`);
    }
    drawn = lines.length;
  };

  return {
    push(chunk) {
      if (stopped) return;
      const parts = (partial + chunk.replace(ANSI_ESCAPE, "")).split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) {
        recent.push(lastSegment(line));
        totalLines += 1;
      }
      if (recent.length > windowLines) recent.splice(0, recent.length - windowLines);
      if (!timer) timer = setTimeout(render, throttleMs);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!stopped) erase();
      stopped = true;
      return totalLines + (partial ? 1 : 0);
    },
  };
}

/** Progress bars rewrite a line with \r; only the last rewrite is visible. */
function lastSegment(line: string): string {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  const index = trimmed.lastIndexOf("\r");
  return (index === -1 ? trimmed : trimmed.slice(index + 1)).replace(/\t/g, "  ");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}
