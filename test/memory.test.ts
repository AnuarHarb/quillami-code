import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { listMemoryFiles, loadProjectMemory } from "../src/memory.ts";
import { withWorkspace } from "./workspace.ts";

describe("memory", () => {
  it("returns empty when the repo has no memory files", async () => {
    await withWorkspace(async (root) => {
      assert.deepEqual(listMemoryFiles(root), []);
      assert.equal(loadProjectMemory(root), "");
    });
  });

  it("loads QUILLAMI.md and AGENTS.md, and truncates huge files", async () => {
    await withWorkspace(async (root) => {
      await writeFile("QUILLAMI.md", "No toques dist.\n");
      await writeFile("AGENTS.md", "Usa tests.\n");

      assert.deepEqual(listMemoryFiles(root), ["QUILLAMI.md", "AGENTS.md"]);
      const memory = loadProjectMemory(root);
      assert.match(memory, /### QUILLAMI\.md/);
      assert.match(memory, /No toques dist\./);
      assert.match(memory, /### AGENTS\.md/);

      await writeFile("QUILLAMI.md", `${"x".repeat(20_000)}\n`);
      const truncated = loadProjectMemory(root);
      assert.match(truncated, /truncated/);
      assert.ok(truncated.length < 20_000);
    });
  });
});
