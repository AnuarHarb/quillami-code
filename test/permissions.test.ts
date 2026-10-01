import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGate } from "../src/permissions.ts";
import type { Choice, Selector } from "../src/select.ts";

describe("permissions", () => {
  it("lets read through without asking", async () => {
    let asked = 0;
    const gate = createGate(async () => {
      asked += 1;
      return "n";
    });

    assert.equal((await gate.authorize("read", { path: "a.ts" })).allowed, true);
    assert.equal(asked, 0);
  });

  it("asks for write and honors s, n, and a", async () => {
    const answers = ["s", "n", "a"];
    const gate = createGate(async () => answers.shift() ?? "n");

    assert.equal((await gate.authorize("write", { path: "a.ts", content: "x" })).allowed, true);
    assert.equal((await gate.authorize("edit", { path: "a.ts" })).allowed, false);
    assert.equal((await gate.authorize("bash", { command: "ls" })).allowed, true);
    assert.equal((await gate.authorize("bash", { command: "pwd" })).allowed, true);
    assert.equal(answers.length, 0);
  });

  it("asks with a list in a terminal, and Esc means no", async () => {
    const offered: string[][] = [];
    const picks: Array<string | null> = ["allow_session", null];
    const select: Selector = {
      one: async <T,>(_prompt: string, choices: Choice<T>[]) => {
        offered.push(choices.map((choice) => `${choice.shortcut} ${choice.label}`));
        return (picks.shift() ?? null) as T | null;
      },
      many: async () => null,
    };
    const gate = createGate(async () => "s", { select });

    assert.equal((await gate.authorize("bash", { command: "ls" })).allowed, true);
    assert.equal((await gate.authorize("bash", { command: "pwd" })).allowed, true);
    assert.equal((await gate.authorize("write", { path: "a.ts", content: "x" })).allowed, false);
    assert.deepEqual(offered[0], [
      "s Sí, solo esta vez",
      "n No, no lo toques",
      "a Sí, y no preguntes más por bash en esta sesión",
    ]);
    assert.equal(offered.length, 2);
  });

  it("accepts sí, yes, and always", async () => {
    const answers = ["sí", "yes", "siempre"];
    const once = createGate(async () => answers.shift() ?? "n");
    assert.equal((await once.authorize("write", { path: "a.ts", content: "1" })).allowed, true);

    const again = createGate(async () => answers.shift() ?? "n");
    assert.equal((await again.authorize("edit", { path: "a.ts" })).allowed, true);

    const session = createGate(async () => answers.shift() ?? "n");
    assert.equal((await session.authorize("bash", { command: "pwd" })).allowed, true);
    assert.equal((await session.authorize("bash", { command: "ls" })).allowed, true);
  });

  it("a approves only that tool, not every risky tool", async () => {
    const answers = ["a", "n", "n"];
    const gate = createGate(async () => answers.shift() ?? "n");

    assert.equal((await gate.authorize("bash", { command: "ls" })).allowed, true);
    assert.equal((await gate.authorize("bash", { command: "pwd" })).allowed, true);
    assert.equal((await gate.authorize("write", { path: "a.ts", content: "x" })).allowed, false);
    assert.equal((await gate.authorize("web_fetch", { url: "https://example.com" })).allowed, false);
    assert.equal(answers.length, 0);
  });

  it("a on an MCP tool covers that server only", async () => {
    const answers = ["a", "n"];
    const gate = createGate(async () => answers.shift() ?? "n");

    assert.equal((await gate.authorize("mcp__easybits__list_files", {})).allowed, true);
    assert.equal((await gate.authorize("mcp__easybits__read_file", {})).allowed, true);
    assert.equal((await gate.authorize("mcp__other__read_file", {})).allowed, false);
    assert.equal(answers.length, 0);
  });

  it("blocks write in plan mode", async () => {
    const gate = createGate(async () => "s", { getMode: () => "plan" });
    const result = await gate.authorize("write", { path: "a.ts", content: "x" });
    assert.equal(result.allowed, false);
    assert.match(result.toolMessage ?? "", /Plan mode/i);
  });

  it("auto-approves write in yolo mode", async () => {
    const gate = createGate(async () => "n", { getMode: () => "yolo" });
    assert.equal(
      (await gate.authorize("write", { path: "a.ts", content: "x" })).allowed,
      true,
    );
  });

  it("honors assessRisk auto-allow without prompting", async () => {
    let asked = 0;
    const gate = createGate(
      async () => {
        asked += 1;
        return "n";
      },
      {
        assessRisk: async () => ({
          action: "allow",
          note: "· auto: solo lectura (Jev 0.92)",
        }),
      },
    );

    assert.equal((await gate.authorize("bash", { command: "ls" })).allowed, true);
    assert.equal(asked, 0);
  });
});
