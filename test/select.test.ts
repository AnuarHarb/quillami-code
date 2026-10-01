import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirm, createSelectState, handleKey, renderSelect, type Choice, type Key } from "../src/select.ts";

const key = (name: string, extra: Partial<Key> = {}): Key => ({ name, sequence: name.length === 1 ? name : "", ...extra });
const type = (char: string): Key => ({ name: char, sequence: char });

const fruits: Choice<string>[] = [
  { value: "mango", label: "Mango" },
  { value: "lulo", label: "Lulo", checked: true },
  { value: "guayaba", label: "Guayaba" },
];

describe("checkbox list", () => {
  it("moves with the arrows, toggles with space, and submits with Enter", () => {
    const state = createSelectState("many", fruits);
    handleKey(state, key("down"));
    handleKey(state, key("down"));
    handleKey(state, key("space"));
    handleKey(state, key("up"));
    handleKey(state, key("space"));
    assert.deepEqual(handleKey(state, key("return")), { kind: "submit", values: ["guayaba"] });
  });

  it("wraps around at both ends", () => {
    const state = createSelectState("many", fruits);
    handleKey(state, key("up"));
    assert.equal(state.cursor, 2);
    handleKey(state, key("down"));
    assert.equal(state.cursor, 0);
  });

  it("keeps the old numbers as a shortcut to toggle", () => {
    const state = createSelectState("many", fruits);
    handleKey(state, type("1"));
    assert.deepEqual(handleKey(state, key("return")), { kind: "submit", values: ["mango", "lulo"] });
  });

  it("shows the validation error instead of submitting", () => {
    const state = createSelectState("many", fruits);
    handleKey(state, key("down"));
    handleKey(state, key("space"));
    const validate = (values: string[]) => (values.length === 0 ? "elige al menos una" : null);
    assert.deepEqual(handleKey(state, key("return"), { validate }), { kind: "continue" });
    assert.equal(state.error, "elige al menos una");
  });

  it("tells Esc apart from Ctrl+C", () => {
    const state = createSelectState("many", fruits);
    assert.deepEqual(handleKey(state, key("escape")), { kind: "cancel", interrupt: false });
    assert.deepEqual(handleKey(state, key("c", { ctrl: true })), { kind: "cancel", interrupt: true });
  });
});

describe("single choice", () => {
  it("submits the marked choice, or the highlighted one when nothing is marked", () => {
    const marked = createSelectState("one", fruits.map((fruit) => ({ ...fruit, checked: false })));
    handleKey(marked, key("space"));
    handleKey(marked, key("down"));
    assert.deepEqual(handleKey(marked, key("return")), { kind: "submit", values: ["mango"] });

    const highlighted = createSelectState("one", fruits, 2);
    highlighted.marked.clear();
    assert.deepEqual(handleKey(highlighted, key("return")), { kind: "submit", values: ["guayaba"] });
  });

  it("picks at once with a letter shortcut", () => {
    const state = createSelectState("one", [
      { value: true, label: "Sí", shortcut: "s" },
      { value: false, label: "No", shortcut: "n" },
    ]);
    assert.deepEqual(handleKey(state, type("n")), { kind: "submit", values: [false] });
  });

  it("filters while typing and restores the list when the query is cleared", () => {
    const state = createSelectState("one", fruits);
    const search = (query: string) => fruits.filter((fruit) => fruit.value.includes(query));
    handleKey(state, type("g"), { search });
    handleKey(state, type("u"), { search });
    assert.deepEqual(state.choices.map((choice) => choice.value), ["guayaba"]);
    handleKey(state, key("backspace"), { search });
    handleKey(state, key("backspace"), { search });
    assert.equal(state.choices, fruits);
  });
});

describe("rendering", () => {
  it("draws checkboxes, the pointer, section headers and the key help", () => {
    const state = createSelectState("many", [
      { value: 1, label: "uno", section: "Primeros" },
      { value: 2, label: "dos", section: "Primeros", checked: true },
    ]);
    const lines = renderSelect(state, "¿Cuáles?", {}, { columns: 80, rows: 24 });
    assert.deepEqual(lines.slice(0, 4), ["? ¿Cuáles?", "  Primeros", "❯ ◻ uno", "  ◼ dos"]);
    assert.match(lines.at(-1)!, /espacio marcar · enter seguir/);
  });

  it("scrolls long lists around the cursor and cuts long lines", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ value: index, label: `modelo-${index}`.padEnd(120, "x") }));
    const state = createSelectState("one", many, 30);
    const lines = renderSelect(state, "¿Qué modelo?", {}, { columns: 60, rows: 12 });
    assert.ok(lines.length <= 12);
    assert.ok(lines.some((line) => line.startsWith("❯ ◯ modelo-30")));
    assert.ok(lines.every((line) => line.length <= 60));
    assert.match(lines.at(-1)!, /31\/40/);
  });
});

describe("confirm", () => {
  it("asks s/N when there is no selector", async () => {
    let asked = "";
    const yes = await confirm("¿Sigo?", { ask: async (prompt) => ((asked = prompt), "s") });
    assert.equal(asked, "¿Sigo? (s/N): ");
    assert.equal(yes, true);
    assert.equal(await confirm("¿Sigo?", { ask: async () => "" }), false);
  });

  it("uses the selector with No highlighted by default", async () => {
    let initial: number | undefined;
    const select = {
      one: async <T,>(_prompt: string, choices: Choice<T>[], options?: { initial?: number }) => {
        initial = options?.initial;
        return choices[0].value;
      },
      many: async () => null,
    };
    assert.equal(await confirm("¿Guardo?", { ask: async () => "", select }), true);
    assert.equal(initial, 1);
  });
});
