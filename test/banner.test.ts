import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderLogo } from "../src/banner.ts";

describe("startup logo", () => {
  it("draws the sun, the horizon, and the reflections with half blocks", () => {
    const lines = renderLogo("none");
    assert.equal(lines.length, 8);
    assert.ok(lines.every((line) => !line.includes("\x1b")));
    assert.match(lines.join("\n"), /█{22}/);
  });

  it("uses the brand colors in 24-bit terminals", () => {
    const art = renderLogo("truecolor").join("\n");
    assert.match(art, /38;2;255;194;61/);
    assert.match(art, /38;2;255;107;74/);
    assert.match(art, /38;2;77;208;225/);
  });

  it("falls back to the 256-color palette", () => {
    const art = renderLogo("256").join("\n");
    assert.match(art, /38;5;\d+/);
    assert.doesNotMatch(art, /38;2;/);
  });
});
