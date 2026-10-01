import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { askJev, jevEnabled, resetJevSessionUsageForTests } from "../src/jev.ts";
import { noul } from "@typesafe-ai/sdk";

describe("jev client", () => {
  const prevKey = process.env.TYPESAFE_API_KEY;
  const prevOff = process.env.QUILLAMI_JEV;

  beforeEach(() => {
    resetJevSessionUsageForTests();
    process.env.TYPESAFE_API_KEY = "test-key";
    delete process.env.QUILLAMI_JEV;
  });

  afterEach(() => {
    resetJevSessionUsageForTests();
    if (prevKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = prevKey;
    if (prevOff === undefined) delete process.env.QUILLAMI_JEV;
    else process.env.QUILLAMI_JEV = prevOff;
  });

  it("jevEnabled respects QUILLAMI_JEV=0", () => {
    process.env.QUILLAMI_JEV = "0";
    assert.equal(jevEnabled(), false);
  });

  it("askJev returns null when fetch fails", async () => {
    const answers = await askJev("hello", { test: noul("Is this a test?") }, {
      fetch: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(answers, null);
  });
});
