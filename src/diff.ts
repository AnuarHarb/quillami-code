import { readFileSync, statSync } from "node:fs";
import { cyan, dim, green, red } from "./banner.js";
import { applyEdit, MAX_FILE_BYTES, resolveInWorkspace } from "./tools.js";

const CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 60;
const MAX_LCS_CELLS = 2_000_000;

type Op = { kind: " " | "-" | "+"; text: string };

export function diffLines(before: string[], after: string[]): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const removed = before.slice(start, endBefore);
  const added = after.slice(start, endAfter);
  const middle =
    removed.length * added.length <= MAX_LCS_CELLS
      ? lcsOps(removed, added)
      : [
          ...removed.map((text): Op => ({ kind: "-", text })),
          ...added.map((text): Op => ({ kind: "+", text })),
        ];

  return [
    ...before.slice(0, start).map((text): Op => ({ kind: " ", text })),
    ...middle,
    ...before.slice(endBefore).map((text): Op => ({ kind: " ", text })),
  ];
}

function lcsOps(a: string[], b: string[]): Op[] {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ kind: "-", text: a[i] });
      i += 1;
    } else {
      ops.push({ kind: "+", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) ops.push({ kind: "-", text: a[i++] });
  while (j < b.length) ops.push({ kind: "+", text: b[j++] });
  return ops;
}

/** Unified-diff hunks (no file headers), uncolored. */
export function unifiedHunks(before: string, after: string): string[] {
  const ops = diffLines(splitLines(before), splitLines(after));
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]));
  if (changed.length === 0) return [];

  const ranges: [number, number][] = [];
  for (const index of changed) {
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(ops.length, index + CONTEXT_LINES + 1);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1]) {
      last[1] = Math.max(last[1], to);
    } else {
      ranges.push([from, to]);
    }
  }

  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const op of ops) {
    oldBefore.push(oldCount);
    newBefore.push(newCount);
    if (op.kind !== "+") oldCount += 1;
    if (op.kind !== "-") newCount += 1;
  }

  const lines: string[] = [];
  for (const [from, to] of ranges) {
    const slice = ops.slice(from, to);
    const oldLen = slice.filter((op) => op.kind !== "+").length;
    const newLen = slice.filter((op) => op.kind !== "-").length;
    const oldStart = oldLen === 0 ? oldBefore[from] : oldBefore[from] + 1;
    const newStart = newLen === 0 ? newBefore[from] : newBefore[from] + 1;
    lines.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const op of slice) lines.push(`${op.kind}${op.text}`);
  }
  return lines;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function renderDiff(lines: string[], maxLines = MAX_DIFF_LINES): string {
  const shown = lines.slice(0, maxLines).map((line) => {
    if (line.startsWith("@@")) return `  ${cyan(line)}`;
    if (line.startsWith("+")) return `  ${green(line)}`;
    if (line.startsWith("-")) return `  ${red(line)}`;
    return `  ${dim(line)}`;
  });
  const hidden = lines.length - shown.length;
  if (hidden > 0) {
    shown.push(dim(`  … ${hidden} ${hidden === 1 ? "línea más" : "líneas más"} del diff`));
  }
  return shown.join("\n");
}

/** Colored diff for a pending write/edit, or a short warning when the edit cannot apply. */
export function previewChange(name: string, input: unknown): string | null {
  if (name !== "write" && name !== "edit") return null;
  const args =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const relative = typeof args.path === "string" ? args.path : "";
  if (!relative) return null;

  let absolute: string;
  try {
    absolute = resolveInWorkspace(relative);
  } catch {
    return null;
  }

  const existing = readExisting(absolute);
  if (existing === "too_large") {
    return dim(`  (archivo de más de ${MAX_FILE_BYTES / 1000} KB; no muestro el diff)`);
  }

  let after: string;
  if (name === "write") {
    after = typeof args.content === "string" ? args.content : "";
  } else {
    const oldString = typeof args.old_string === "string" ? args.old_string : "";
    const newString = typeof args.new_string === "string" ? args.new_string : "";
    if (existing === null) {
      return dim("  (el archivo no existe; la edición va a fallar)");
    }
    const matches = oldString ? existing.split(oldString).length - 1 : 0;
    if (matches === 0) {
      return dim("  (old_string no aparece en el archivo; la edición va a fallar)");
    }
    if (matches > 1) {
      return dim(`  (old_string aparece ${matches} veces; la edición va a fallar)`);
    }
    after = applyEdit(existing, oldString, newString);
  }

  const hunks = unifiedHunks(existing ?? "", after);
  if (hunks.length === 0) return dim("  (sin cambios)");
  const header = existing === null ? dim("  archivo nuevo") : null;
  const body = renderDiff(hunks);
  return header ? `${header}\n${body}` : body;
}

function readExisting(absolute: string): string | null | "too_large" {
  try {
    if (statSync(absolute).size > MAX_FILE_BYTES) return "too_large";
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}
