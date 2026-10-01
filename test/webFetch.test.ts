import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublicHost,
  fetchPublicUrl,
  htmlToText,
  validatePublicUrl,
} from "../src/webFetch.ts";

describe("webFetch", () => {
  it("rejects private hosts", () => {
    assert.throws(() => assertPublicHost("127.0.0.1"));
    assert.throws(() => assertPublicHost("localhost"));
    assert.throws(() => assertPublicHost("192.168.1.1"));
  });

  it("allows public https URLs", () => {
    const url = validatePublicUrl("https://example.com/path");
    assert.equal(url.hostname, "example.com");
  });

  it("strips basic HTML", () => {
    const text = htmlToText("<html><body><p>Hello</p></body></html>");
    assert.match(text, /Hello/);
  });

  it("truncates long responses", async () => {
    const body = "x".repeat(100);
    const out = await fetchPublicUrl("https://example.com", {
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      maxChars: 20,
    });
    assert.match(out, /truncated at 20/);
  });
});
