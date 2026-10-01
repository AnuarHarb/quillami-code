import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HeadTailBuffer, truncateMiddle } from "../src/truncate.ts";

describe("truncate", () => {
  it("leaves short text alone", () => {
    assert.equal(truncateMiddle("hola", 10), "hola");
  });

  it("keeps the head and tail of long text", () => {
    const text = `${"a".repeat(50)}${"\n".repeat(5)}${"z".repeat(50)}`;
    const out = truncateMiddle(text, 20);
    assert.ok(out.startsWith("a".repeat(10)));
    assert.ok(out.endsWith("z".repeat(10)));
    assert.match(out, /omitted 85 characters, 5 lines/);
  });

  it("streams into a bounded head and tail", () => {
    const buffer = new HeadTailBuffer(10);
    for (const chunk of ["12345", "67890", "abcde", "fghij"]) buffer.push(chunk);
    assert.equal(buffer.toString(), "12345\n\n... [omitted 10 characters] ...\n\nfghij");
  });

  it("returns everything when it fits", () => {
    const buffer = new HeadTailBuffer(10);
    buffer.push("abc");
    buffer.push("def");
    assert.equal(buffer.toString(), "abcdef");
  });
});
