import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../src/cli.ts";

describe("cli", () => {
  it("parses subcommands", () => {
    assert.deepEqual(parseArgs(["doctor"]).command, "doctor");
    assert.deepEqual(parseArgs(["sessions"]).command, "sessions");
    assert.deepEqual(parseArgs(["mcp"]).command, "mcp");
    const models = parseArgs(["models", "qwen", "coder"]);
    assert.equal(models.command, "models");
    assert.equal(models.query, "qwen coder");
    assert.equal(parseArgs(["models"]).query, undefined);
    assert.equal(parseArgs(["setup"]).command, "setup");
  });

  it("parses one-shot prompt and flags", () => {
    const args = parseArgs(["--model", "haiku", "--yolo", "fix", "the", "test"]);
    assert.equal(args.command, "chat");
    assert.equal(args.prompt, "fix the test");
    assert.equal(args.model, "haiku");
    assert.equal(args.mode, "yolo");
  });

  it("parses resume and continue", () => {
    const resume = parseArgs(["--resume", "abc123"]);
    assert.equal(resume.resume, "abc123");
    const cont = parseArgs(["-c", "--plan"]);
    assert.equal(cont.continueLast, true);
    assert.equal(cont.mode, "plan");
  });
});
