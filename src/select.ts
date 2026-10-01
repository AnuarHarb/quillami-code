import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { bold, cyan, dim, green } from "./banner.js";

export type Choice<T> = {
  value: T;
  label: string;
  hint?: string;
  /** Rows sharing a section get one dim header above them. */
  section?: string;
  /** A key that picks this choice at once (e.g. `s` for "sí"). */
  shortcut?: string;
  checked?: boolean;
};

export type Key = { name?: string; ctrl?: boolean; sequence?: string };

type Mode = "one" | "many";

export type SelectOptions<T> = {
  /** Cursor starts here instead of the first choice. */
  initial?: number;
  /** Typing filters: called with the query, empty query means the original list. */
  search?: (query: string) => Choice<T>[];
  /** Shown under the list when nothing matches the query. */
  emptyText?: string;
  /** Returns an error to show instead of submitting. */
  validate?: (values: T[]) => string | null;
  /** One line left in the scrollback after the choice. */
  summary?: (values: T[]) => string;
  /** Ctrl+C, as opposed to Esc; both cancel the choice. */
  onInterrupt?: () => void;
};

export type Selector = {
  one<T>(prompt: string, choices: Choice<T>[], options?: SelectOptions<T>): Promise<T | null>;
  many<T>(prompt: string, choices: Choice<T>[], options?: SelectOptions<T>): Promise<T[] | null>;
};

export type SelectState<T> = {
  mode: Mode;
  base: Choice<T>[];
  choices: Choice<T>[];
  cursor: number;
  marked: Set<number>;
  query: string;
  error: string;
};

export type KeyResult<T> =
  | { kind: "continue" }
  | { kind: "submit"; values: T[] }
  | { kind: "cancel"; interrupt: boolean };

export function createSelectState<T>(mode: Mode, choices: Choice<T>[], initial = 0): SelectState<T> {
  const marked = new Set<number>();
  choices.forEach((choice, index) => {
    if (choice.checked) marked.add(index);
  });
  return {
    mode,
    base: choices,
    choices,
    cursor: Math.min(Math.max(initial, 0), Math.max(choices.length - 1, 0)),
    marked,
    query: "",
    error: "",
  };
}

export function handleKey<T>(state: SelectState<T>, key: Key, options: SelectOptions<T> = {}): KeyResult<T> {
  const char = key.sequence ?? "";
  state.error = "";
  if (key.ctrl && key.name === "c") return { kind: "cancel", interrupt: true };
  if ((key.ctrl && key.name === "d") || key.name === "escape") return { kind: "cancel", interrupt: false };

  const count = state.choices.length;
  if (key.name === "up" || (key.ctrl && key.name === "p")) {
    if (count > 0) state.cursor = (state.cursor - 1 + count) % count;
    return { kind: "continue" };
  }
  if (key.name === "down" || key.name === "tab" || (key.ctrl && key.name === "n")) {
    if (count > 0) state.cursor = (state.cursor + 1) % count;
    return { kind: "continue" };
  }
  if (key.name === "space") {
    mark(state, state.cursor);
    return { kind: "continue" };
  }
  if (key.name === "return" || key.name === "enter") {
    const values = submitted(state);
    if (values.length === 0 && state.mode === "one") return { kind: "continue" };
    const error = options.validate?.(values);
    if (error) {
      state.error = error;
      return { kind: "continue" };
    }
    return { kind: "submit", values };
  }

  if (options.search) {
    if (key.name === "backspace") {
      setQuery(state, state.query.slice(0, -1), options.search);
    } else if (!key.ctrl && char.length === 1 && char > " ") {
      setQuery(state, state.query + char, options.search);
    }
    return { kind: "continue" };
  }

  const shortcut = state.choices.findIndex((choice) => choice.shortcut === char.toLowerCase());
  if (char && shortcut >= 0) {
    state.cursor = shortcut;
    if (state.mode === "one") return { kind: "submit", values: [state.choices[shortcut].value] };
    mark(state, shortcut);
    return { kind: "continue" };
  }
  if (/^[1-9]$/.test(char) && Number(char) <= count) {
    state.cursor = Number(char) - 1;
    mark(state, state.cursor);
  }
  return { kind: "continue" };
}

function mark<T>(state: SelectState<T>, index: number): void {
  if (index >= state.choices.length) return;
  if (state.mode === "one") {
    state.marked = new Set([index]);
  } else if (state.marked.has(index)) {
    state.marked.delete(index);
  } else {
    state.marked.add(index);
  }
}

function submitted<T>(state: SelectState<T>): T[] {
  if (state.mode === "many") {
    return [...state.marked].sort((a, b) => a - b).map((index) => state.choices[index].value);
  }
  const index = state.marked.size > 0 ? [...state.marked][0] : state.cursor;
  const choice = state.choices[index];
  return choice ? [choice.value] : [];
}

function setQuery<T>(state: SelectState<T>, query: string, search: (query: string) => Choice<T>[]): void {
  state.query = query;
  state.choices = query ? search(query) : state.base;
  state.cursor = 0;
  state.marked = new Set();
}

const POINTER = "❯";
const BOXES: Record<Mode, [string, string]> = { one: ["◯", "◉"], many: ["◻", "◼"] };

export function renderSelect<T>(
  state: SelectState<T>,
  prompt: string,
  options: SelectOptions<T>,
  size: { columns: number; rows: number },
): string[] {
  const width = Math.max(20, size.columns - 1);
  const lines = [`${green("?")} ${bold(prompt)}`];
  if (options.search) lines.push(`  ${dim("buscar:")} ${state.query}${cyan("▏")}`);

  type Row = { header: string } | { index: number };
  const rows: Row[] = [];
  state.choices.forEach((choice, index) => {
    const section = choice.section;
    if (section && (index === 0 || state.choices[index - 1].section !== section)) {
      if (index > 0) rows.push({ header: "" });
      rows.push({ header: section });
    }
    rows.push({ index });
  });

  const room = Math.max(3, Math.min(rows.length, size.rows - lines.length - 3));
  const cursorRow = rows.findIndex((row) => "index" in row && row.index === state.cursor);
  const start = Math.min(Math.max(0, cursorRow - Math.floor(room / 2)), Math.max(0, rows.length - room));
  for (const row of rows.slice(start, start + room)) {
    if ("header" in row) {
      lines.push(row.header ? dim(`  ${fit(row.header, width - 2)}`) : "");
      continue;
    }
    const choice = state.choices[row.index];
    const active = row.index === state.cursor;
    const box = BOXES[state.mode][state.marked.has(row.index) ? 1 : 0];
    const head = `${active ? POINTER : " "} ${box} `;
    const label = fit(choice.label, width - head.length);
    const hint = choice.hint ? fit(`  ${choice.hint}`, width - head.length - label.length) : "";
    const painted = state.marked.has(row.index) ? green(`${head}${label}`) : active ? cyan(`${head}${label}`) : `${head}${label}`;
    lines.push(painted + dim(hint));
  }

  if (state.choices.length === 0) lines.push(dim(`  ${options.emptyText ?? "nada coincide"}`));
  const position = rows.length > room ? `${state.cursor + 1}/${state.choices.length} · ` : "";
  const keys =
    state.mode === "many"
      ? "↑↓ moverse · espacio marcar · enter seguir · esc cancelar"
      : options.search
        ? "↑↓ moverse · espacio marcar · enter elegir · escribe para buscar · esc salir"
        : "↑↓ moverse · espacio marcar · enter elegir · esc cancelar";
  lines.push(dim(`  ${fit(position + keys, width - 2)}`));
  if (state.error) lines.push(`  ${state.error}`);
  return lines;
}

/** Terminal rows a line takes once it wraps. */
function screenRows(line: string, columns: number): number {
  const visible = line.replace(/\x1b\[[\d;]*m/g, "").length;
  return Math.max(1, Math.ceil(visible / columns));
}

function fit(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** Arrow keys, space and Enter need a terminal on both ends. */
export function interactiveTerminal(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/**
 * Takes over stdin until a choice is made. Any readline interface keeps its
 * listeners, detached meanwhile, so it neither echoes the keys nor sees Ctrl+C.
 */
async function runSelect<T>(
  mode: Mode,
  prompt: string,
  choices: Choice<T>[],
  options: SelectOptions<T> = {},
): Promise<T[] | null> {
  const state = createSelectState(mode, choices, options.initial);
  emitKeypressEvents(stdin);
  const saved = stdin.listeners("keypress") as ((...args: unknown[]) => void)[];
  stdin.removeAllListeners("keypress");
  const wasRaw = stdin.isRaw;
  const wasFlowing = stdin.readableFlowing === true;
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write("\x1b[?25l");

  let drawn = 0;
  const draw = () => {
    const columns = stdout.columns || 80;
    const lines = renderSelect(state, prompt, options, { columns, rows: stdout.rows || 24 });
    stdout.write(`${drawn > 0 ? `\x1b[${drawn}A\r` : "\r"}\x1b[J${lines.join("\n")}\n`);
    drawn = lines.reduce((total, line) => total + screenRows(line, columns), 0);
  };

  return await new Promise<T[] | null>((resolve) => {
    const finish = (values: T[] | null) => {
      stdin.removeListener("keypress", onKey);
      stdout.removeListener("resize", draw);
      const line =
        values === null
          ? `${dim("✖")} ${bold(prompt)} ${dim("cancelado")}`
          : `${green("✔")} ${bold(prompt)} ${dim(options.summary?.(values) ?? summarize(state, values))}`;
      stdout.write(`\x1b[${drawn}A\r\x1b[J${line}\n\x1b[?25h`);
      stdin.setRawMode(wasRaw);
      if (!wasFlowing) stdin.pause();
      for (const listener of saved) stdin.on("keypress", listener);
      resolve(values);
    };
    const onKey = (_text: string | undefined, key: Key | undefined) => {
      const result = handleKey(state, key ?? { sequence: _text }, options);
      if (result.kind === "cancel") {
        finish(null);
        if (result.interrupt) options.onInterrupt?.();
      } else if (result.kind === "submit") finish(result.values);
      else draw();
    };
    stdin.on("keypress", onKey);
    stdout.on("resize", draw);
    draw();
  });
}

function summarize<T>(state: SelectState<T>, values: T[]): string {
  if (values.length === 0) return "nada";
  const labels = state.choices
    .filter((choice) => values.includes(choice.value))
    .map((choice) => choice.label.trim().split(/\s{2,}/)[0]);
  return labels.join(", ");
}

export const terminalSelector: Selector = {
  one: async (prompt, choices, options) => (await runSelect("one", prompt, choices, options))?.[0] ?? null,
  many: (prompt, choices, options) => runSelect("many", prompt, choices, options),
};

/** Yes/no with a selector when there is one, a typed s/N answer otherwise. */
export async function confirm(
  prompt: string,
  io: { ask: (prompt: string) => Promise<string>; select?: Selector },
  defaultYes = false,
): Promise<boolean> {
  if (io.select) {
    const answer = await io.select.one(
      prompt,
      [
        { value: true, label: "Sí", shortcut: "s" },
        { value: false, label: "No", shortcut: "n" },
      ],
      { initial: defaultYes ? 0 : 1 },
    );
    return answer === true;
  }
  const raw = (await io.ask(`${prompt} (${defaultYes ? "S/n" : "s/N"}): `)).trim();
  return raw ? /^(s|y)/i.test(raw) : defaultYes;
}
