import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  loadGlobalMemory,
  loadProjects,
  rememberUser,
  touchProjectRegistry,
  userDir,
} from "../src/userMemory.ts";

describe("userMemory", () => {
  let tempHome = "";
  const previousHome = process.env.HOME;

  afterEach(() => {
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  });

  function useTempHome(): void {
    tempHome = mkdtempSync(path.join(tmpdir(), "quillami-home-"));
    process.env.HOME = tempHome;
  }

  it("registers projects and bumps sessions on repeat visits", () => {
    useTempHome();
    const project = mkdtempSync(path.join(tmpdir(), "quillami-proj-"));
    touchProjectRegistry(project);
    touchProjectRegistry(project);

    const entries = loadProjects();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.sessions, 2);
    assert.equal(entries[0]?.path, path.resolve(project));
  });

  it("append and replace_section write only under user dir", async () => {
    useTempHome();
    await rememberUser({
      target: "user",
      mode: "append",
      content: "Le gusta TypeScript.",
    });
    await rememberUser({
      target: "behaviors",
      mode: "replace_section",
      heading: "## Preferencias",
      content: "- Respuestas cortas",
    });

    const userFile = readFileSync(path.join(userDir(), "user.md"), "utf8");
    assert.match(userFile, /Le gusta TypeScript/);
    const behaviors = readFileSync(path.join(userDir(), "behaviors.md"), "utf8");
    assert.match(behaviors, /## Preferencias/);
    assert.match(behaviors, /Respuestas cortas/);
    assert.doesNotMatch(behaviors, /Le gusta TypeScript/);
  });

  it("loadGlobalMemory includes behaviors, soul, and user", async () => {
    useTempHome();
    await rememberUser({ target: "soul", mode: "append", content: "Identidad Quillami." });
    await rememberUser({ target: "user", mode: "append", content: "Dev caribeño." });
    await rememberUser({
      target: "behaviors",
      mode: "append",
      content: "Siempre en español si el usuario escribe en español.",
    });

    const loaded = loadGlobalMemory();
    assert.match(loaded.body, /behaviors\.md/);
    assert.match(loaded.body, /soul\.md/);
    assert.match(loaded.body, /user\.md/);
    assert.match(loaded.body, /Dev caribeño/);
  });
});
