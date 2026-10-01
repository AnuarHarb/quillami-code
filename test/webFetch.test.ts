import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  assertPublicHost,
  createPinnedFetch,
  fetchPublicUrl,
  guardedLookup,
  htmlToText,
  isPrivateAddress,
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

  const publicLookup = async () => ["93.184.216.34"];

  it("truncates long responses", async () => {
    const body = "x".repeat(100);
    const out = await fetchPublicUrl("https://example.com", {
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      lookup: publicLookup,
      maxChars: 20,
    });
    assert.match(out, /truncated at 20/);
  });

  it("refuses a redirect to a private address before requesting it", async () => {
    const requested: string[] = [];
    await assert.rejects(
      fetchPublicUrl("https://example.com", {
        fetchImpl: async (input) => {
          requested.push(String(input));
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          });
        },
        lookup: publicLookup,
      }),
      /private/,
    );
    assert.deepEqual(requested, ["https://example.com/"]);
  });

  it("follows public redirects", async () => {
    const out = await fetchPublicUrl("https://example.com", {
      fetchImpl: async (input) =>
        String(input).includes("/final")
          ? new Response("done", { status: 200, headers: { "content-type": "text/plain" } })
          : new Response(null, { status: 301, headers: { location: "/final" } }),
      lookup: publicLookup,
    });
    assert.equal(out, "done");
  });

  it("refuses a public name that resolves to a private address", async () => {
    let fetched = false;
    await assert.rejects(
      fetchPublicUrl("https://internal.example.com", {
        fetchImpl: async () => {
          fetched = true;
          return new Response("secret");
        },
        lookup: async () => ["10.0.0.5"],
      }),
      /private address/,
    );
    assert.equal(fetched, false);
  });

  it("blocks DNS rebinding: the address the socket uses is checked too", async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.end("secret");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    let lookups = 0;
    try {
      await assert.rejects(
        fetchPublicUrl(`http://rebind.test:${port}/`, {
          lookup: async () => (++lookups === 1 ? ["93.184.216.34"] : ["127.0.0.1"]),
        }),
        /private address/,
      );
      assert.equal(lookups, 2);
      assert.equal(requests, 0);
    } finally {
      server.close();
    }
  });

  it("guardedLookup hands public addresses to the socket", async () => {
    const lookup = guardedLookup(async () => ["93.184.216.34", "2606:2800::1"]);
    const single = await new Promise<[string, number]>((resolve, reject) =>
      lookup("example.com", {}, (error, address, family) =>
        error ? reject(error) : resolve([address as string, family ?? 0]),
      ),
    );
    assert.deepEqual(single, ["93.184.216.34", 4]);

    const all = await new Promise<unknown>((resolve, reject) =>
      lookup("example.com", { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      ),
    );
    assert.deepEqual(all, [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800::1", family: 6 },
    ]);
  });

  it("pinned fetch decodes gzip and passes redirects through", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/go") {
        res.writeHead(302, { location: "/final" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      res.end(gzipSync("hola caribe"));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const pinned = createPinnedFetch(async () => []);
    try {
      const redirect = await pinned(`http://127.0.0.1:${port}/go`);
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get("location"), "/final");

      const ok = await pinned(`http://127.0.0.1:${port}/final`);
      assert.equal(await ok.text(), "hola caribe");
    } finally {
      server.close();
    }
  });

  it("classifies private IPv4 and IPv6 addresses", () => {
    assert.equal(isPrivateAddress("10.1.2.3"), true);
    assert.equal(isPrivateAddress("172.20.0.1"), true);
    assert.equal(isPrivateAddress("0.0.0.0"), true);
    assert.equal(isPrivateAddress("::1"), true);
    assert.equal(isPrivateAddress("fd00::1"), true);
    assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateAddress("8.8.8.8"), false);
    assert.equal(isPrivateAddress("2606:4700::1111"), false);
  });
});
