import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { bashTimeoutSeconds, executeBuiltinTool, executeTool } from "../src/tools.ts";
import { withWorkspace } from "./workspace.ts";

describe("tools", () => {
  it("writes, reads with line numbers, and edits a unique match", async () => {
    await withWorkspace(async () => {
      await executeTool("write", { path: "src/hi.ts", content: "const n = 1;\n" });
      const read = await executeTool("read", { path: "src/hi.ts" });
      assert.match(read, /1\|const n = 1;/);

      await executeTool("edit", {
        path: "src/hi.ts",
        old_string: "const n = 1;",
        new_string: "const n = 2;",
      });
      const after = await readFile("src/hi.ts", "utf8");
      assert.equal(after, "const n = 2;\n");
    });
  });

  it("rejects edit when the old string is missing or not unique", async () => {
    await withWorkspace(async () => {
      await executeTool("write", { path: "a.txt", content: "hola hola\n" });

      await assert.rejects(
        () =>
          executeTool("edit", {
            path: "a.txt",
            old_string: "adios",
            new_string: "chao",
          }),
        /not found/,
      );

      await assert.rejects(
        () =>
          executeTool("edit", {
            path: "a.txt",
            old_string: "hola",
            new_string: "hey",
          }),
        /exactly once/,
      );
    });
  });

  it("refuses paths outside the workspace", async () => {
    await withWorkspace(async () => {
      await assert.rejects(
        () => executeTool("read", { path: "../secret.txt" }),
        /outside the workspace/,
      );
    });
  });

  it("lists, greps, globs, and hides ignored folders", async () => {
    await withWorkspace(async () => {
      await mkdir("src");
      await mkdir("node_modules");
      await writeFile("src/app.ts", "export const killa = true;\n");
      await writeFile("node_modules/pkg.js", "ignored\n");

      const listing = await executeTool("ls", { path: "." });
      assert.match(listing, /dir {2}src/);
      assert.doesNotMatch(listing, /node_modules/);

      const hits = await executeTool("grep", { pattern: "killa", path: "." });
      assert.match(hits, /src\/app\.ts:1:/);

      const files = await executeTool("glob", { pattern: "**/*.ts" });
      assert.match(files, /src\/app\.ts/);
      assert.doesNotMatch(files, /node_modules/);
    });
  });

  it("pages read with offset and limit", async () => {
    await withWorkspace(async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `linea ${i + 1}`).join("\n");
      await writeFile("big.txt", `${lines}\n`);

      const page = await executeTool("read", { path: "big.txt", offset: 4, limit: 3 });
      assert.match(page, /^ {3}4\|linea 4\n {3}5\|linea 5\n {3}6\|linea 6/);
      assert.doesNotMatch(page, /linea 7/);
      assert.match(page, /lines 4-6 of 10; call read with offset=7 to continue/);

      const tail = await executeTool("read", { path: "big.txt", offset: 9 });
      assert.match(tail, /lines 9-10 of 10\)$/);

      const whole = await executeTool("read", { path: "big.txt" });
      assert.doesNotMatch(whole, /lines \d/);

      await assert.rejects(
        () => executeTool("read", { path: "big.txt", offset: 50 }),
        /past the end/,
      );
    });
  });

  it("cuts very long lines in read", async () => {
    await withWorkspace(async () => {
      await writeFile("min.js", "x".repeat(5_000));
      const out = await executeTool("read", { path: "min.js" });
      assert.match(out, /line cut, 5000 characters/);
      assert.ok(out.length < 2_200);
    });
  });

  it("keeps the head and tail of huge bash output", async () => {
    await withWorkspace(async () => {
      const out = await executeTool("bash", {
        command: "echo PRIMERA; seq 1 50000; echo ULTIMA",
      });
      assert.match(out, /PRIMERA/);
      assert.match(out, /ULTIMA/);
      assert.match(out, /omitted \d+ characters/);
      assert.ok(out.length < 13_000);
    });
  });

  it("gives bash an empty stdin instead of hanging", async () => {
    await withWorkspace(async () => {
      const started = Date.now();
      const out = await executeTool("bash", { command: "cat; echo fin" });
      assert.match(out, /fin/);
      assert.ok(Date.now() - started < 5_000);
    });
  });

  it("cancelling bash kills the whole process group", async () => {
    await withWorkspace(async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 300);
      const started = Date.now();
      const out = await executeBuiltinTool(
        "bash",
        { command: "sleep 30 & echo $! > bg.pid; wait" },
        { signal: controller.signal },
      );
      assert.ok(Date.now() - started < 5_000);
      assert.match(out, /the user cancelled the turn/);

      const pid = Number((await readFile("bg.pid", "utf8")).trim());
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
    });
  });

  it("honors a per-call bash timeout and clamps it", async () => {
    await withWorkspace(async () => {
      const started = Date.now();
      const out = await executeTool("bash", { command: "sleep 10", timeout_seconds: 1 });
      assert.ok(Date.now() - started < 5_000);
      assert.match(out, /stopped after 1s timeout; retry with a higher timeout_seconds/);

      assert.equal(bashTimeoutSeconds({}), 120);
      assert.equal(bashTimeoutSeconds({ timeout_seconds: 600 }), 600);
      assert.equal(bashTimeoutSeconds({ timeout_seconds: 99_999 }), 1800);
      assert.equal(bashTimeoutSeconds({ timeout_seconds: 0 }), 120);
    });
  });

  it("streams bash output while it runs", async () => {
    await withWorkspace(async () => {
      const chunks: string[] = [];
      const out = await executeBuiltinTool(
        "bash",
        { command: "echo uno; echo dos >&2" },
        { onOutput: (chunk) => chunks.push(chunk) },
      );
      assert.match(chunks.join(""), /uno/);
      assert.match(chunks.join(""), /dos/);
      assert.match(out, /stdout:\nuno/);
      assert.match(out, /stderr:\ndos/);
    });
  });

  it("runs bash in the workspace and rejects unknown tools", async () => {
    await withWorkspace(async () => {
      const output = await executeTool("bash", { command: "echo costeño && pwd" });
      assert.match(output, /exit 0/);
      assert.match(output, /costeño/);
      assert.match(output, new RegExp(path.basename(process.cwd())));

      await assert.rejects(() => executeTool("fly", {}), /unknown tool/);
    });
  });
});
