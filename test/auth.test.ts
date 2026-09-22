import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { saveUserKey } from "../src/auth.ts";

describe("auth", () => {
  let tempDir = "";

  afterEach(() => {
    tempDir = "";
  });

  it("upserts keys without dropping other vars", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "quillami-auth-"));
    const file = path.join(tempDir, ".env");
    saveUserKey("ANTHROPIC_API_KEY", "first", file);
    saveUserKey("MINIMAX_API_KEY", "mm-key", file);
    saveUserKey("ANTHROPIC_API_KEY", "rotated", file);

    const body = readFileSync(file, "utf8");
    assert.match(body, /^ANTHROPIC_API_KEY=rotated$/m);
    assert.match(body, /^MINIMAX_API_KEY=mm-key$/m);
    assert.equal(body.split("ANTHROPIC_API_KEY=").length - 1, 1);
  });
});
