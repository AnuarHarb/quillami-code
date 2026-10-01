import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGate } from "../src/permissions.ts";

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
    assert.equal((await gate.authorize("write", { path: "b.ts", content: "y" })).allowed, true);
    assert.equal(answers.length, 0);
  });

  it("accepts sí, yes, and always", async () => {
    const answers = ["sí", "yes", "siempre"];
    const once = createGate(async () => answers.shift() ?? "n");
    assert.equal((await once.authorize("write", { path: "a.ts", content: "1" })).allowed, true);

    const again = createGate(async () => answers.shift() ?? "n");
    assert.equal((await again.authorize("edit", { path: "a.ts" })).allowed, true);

    const session = createGate(async () => answers.shift() ?? "n");
    assert.equal((await session.authorize("bash", { command: "pwd" })).allowed, true);
    assert.equal((await session.authorize("write", { path: "b.ts", content: "2" })).allowed, true);
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
