import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ripgrepSearch } from "../src/ripgrep.ts";
import { executeTool } from "../src/tools.ts";
import { withWorkspace } from "./workspace.ts";

function hasRipgrep(): boolean {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const base = {
  maxHits: 50,
  maxLineChars: 300,
  maxFileBytes: 200_000,
  ignoreDirs: ["node_modules", ".git", "dist"],
};

async function seedRepo(): Promise<void> {
  await mkdir("src");
  await mkdir(".github");
  await mkdir("node_modules");
  await mkdir("logs");
  await writeFile(".gitignore", "logs/\n");
  await writeFile("src/app.ts", "export const quillami = 1;\n");
  await writeFile(".github/ci.yml", "name: quillami\n");
  await writeFile("node_modules/pkg.js", "quillami\n");
  await writeFile("logs/run.log", "quillami\n");
  execFileSync("git", ["init", "-q"]);
}

describe("grep with ripgrep", { skip: !hasRipgrep() && "rg is not installed" }, () => {
  it("respects .gitignore, includes dotfiles, and skips node_modules", async () => {
    await withWorkspace(async (root) => {
      await seedRepo();
      const result = await ripgrepSearch("quillami", ".", { ...base, cwd: root });
      assert.deepEqual(result, {
        hits: [".github/ci.yml:1:name: quillami", "src/app.ts:1:export const quillami = 1;"],
        truncated: false,
      });
    });
  });

  it("stops at the hit limit and cuts long lines", async () => {
    await withWorkspace(async (root) => {
      await writeFile("many.txt", `${"hit\n".repeat(20)}${"hit".padEnd(1000, "x")}\n`);
      const limited = await ripgrepSearch("hit", ".", { ...base, cwd: root, maxHits: 5 });
      assert.equal(limited?.hits.length, 5);
      assert.equal(limited?.truncated, true);

      const long = await ripgrepSearch("hitx", ".", { ...base, cwd: root, maxLineChars: 20 });
      assert.equal(long?.hits[0], "many.txt:21:hitxxxxx ...");
    });
  });

  it("returns no hits, not a fallback, when nothing matches", async () => {
    await withWorkspace(async (root) => {
      await writeFile("a.txt", "hola\n");
      assert.deepEqual(await ripgrepSearch("adios", ".", { ...base, cwd: root }), {
        hits: [],
        truncated: false,
      });
    });
  });

  it("falls back to the JavaScript search for patterns rg cannot parse", async () => {
    await withWorkspace(async (root) => {
      await writeFile("a.ts", "const fooBar = 1;\n");
      assert.equal(await ripgrepSearch("(?<=foo)Bar", ".", { ...base, cwd: root }), null);
      const out = await executeTool("grep", { pattern: "(?<=foo)Bar" });
      assert.match(out, /a\.ts:1:const fooBar = 1;/);
    });
  });
});

describe("grep fallback", () => {
  it("returns null when the rg binary does not exist", async () => {
    await withWorkspace(async (root) => {
      const result = await ripgrepSearch("x", ".", {
        ...base,
        cwd: root,
        binary: "/nonexistent/rg",
      });
      assert.equal(result, null);
    });
  });

  it("the built-in search still works with QUILLAMI_RG=off", async () => {
    const previous = process.env.QUILLAMI_RG;
    process.env.QUILLAMI_RG = "off";
    try {
      await withWorkspace(async () => {
        await mkdir("src");
        await writeFile("src/app.ts", "export const killa = true;\n");
        assert.match(await executeTool("grep", { pattern: "killa" }), /src\/app\.ts:1:/);
      });
    } finally {
      if (previous === undefined) delete process.env.QUILLAMI_RG;
      else process.env.QUILLAMI_RG = previous;
    }
  });
});
