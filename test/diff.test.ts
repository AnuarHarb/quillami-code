import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { previewChange, renderDiff, unifiedHunks } from "../src/diff.ts";
import { applyEdit } from "../src/tools.ts";
import { withWorkspace } from "./workspace.ts";

describe("diff", () => {
  it("returns no hunks for identical text", () => {
    assert.deepEqual(unifiedHunks("a\nb\n", "a\nb\n"), []);
  });

  it("shows a changed line with three lines of context", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n") + "\n";
    const after = before.replace("5", "cinco");
    assert.deepEqual(unifiedHunks(before, after), [
      "@@ -2,7 +2,7 @@",
      " 2",
      " 3",
      " 4",
      "-5",
      "+cinco",
      " 6",
      " 7",
      " 8",
    ]);
  });

  it("splits distant changes into separate hunks", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `l${i + 1}`);
    const before = lines.join("\n");
    const after = lines
      .map((line) => (line === "l2" ? "dos" : line === "l28" ? "veintiocho" : line))
      .join("\n");
    const hunks = unifiedHunks(before, after).filter((line) => line.startsWith("@@"));
    assert.deepEqual(hunks, ["@@ -1,5 +1,5 @@", "@@ -25,6 +25,6 @@"]);
  });

  it("shows a new file as all additions", () => {
    assert.deepEqual(unifiedHunks("", "a\nb\n"), ["@@ -0,0 +1,2 @@", "+a", "+b"]);
  });

  it("caps long diffs", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `+${i}`);
    const out = renderDiff(lines, 4);
    assert.match(out, /6 líneas más del diff/);
    assert.equal(out.split("\n").length, 5);
  });

  it("previews an edit against the file on disk", async () => {
    await withWorkspace(async () => {
      await writeFile("a.ts", "const x = 1;\nconst y = 2;\n");
      const out = previewChange("edit", {
        path: "a.ts",
        old_string: "const y = 2;",
        new_string: "const y = 3;",
      });
      assert.match(out ?? "", /-const y = 2;/);
      assert.match(out ?? "", /\+const y = 3;/);
    });
  });

  it("warns when the edit cannot apply", async () => {
    await withWorkspace(async () => {
      await writeFile("a.ts", "x\nx\n");
      assert.match(
        previewChange("edit", { path: "a.ts", old_string: "x", new_string: "y" }) ?? "",
        /aparece 2 veces/,
      );
      assert.match(
        previewChange("edit", { path: "a.ts", old_string: "z", new_string: "y" }) ?? "",
        /no aparece/,
      );
    });
  });

  it("marks a write to a missing file as new", async () => {
    await withWorkspace(async () => {
      const out = previewChange("write", { path: "nuevo.ts", content: "hola\n" });
      assert.match(out ?? "", /archivo nuevo/);
      assert.match(out ?? "", /\+hola/);
    });
  });

  it("ignores tools that do not change files", () => {
    assert.equal(previewChange("bash", { command: "ls" }), null);
  });

  it("keeps dollar patterns in edits literal", () => {
    assert.equal(applyEdit("price = X", "X", "$& and $$"), "price = $& and $$");
  });
});
