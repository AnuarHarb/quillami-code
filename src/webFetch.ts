import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";

const DEFAULT_MAX_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5_000_000;
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export type LookupFn = (hostname: string) => Promise<string[]>;

export type WebFetchOptions = {
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  maxChars?: number;
};

const defaultLookup: LookupFn = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
};

export async function fetchPublicUrl(
  rawUrl: string,
  options?: WebFetchOptions,
): Promise<string> {
  const lookup = options?.lookup ?? defaultLookup;
  const fetchImpl = options?.fetchImpl ?? createPinnedFetch(lookup);
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let url = validatePublicUrl(rawUrl);
  let response: Response;
  try {
    for (let hop = 0; ; hop += 1) {
      await assertResolvesPublic(url.hostname, lookup);
      response = await fetchImpl(url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,application/json,text/plain,*/*" },
      });

      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) break;
      if (hop >= MAX_REDIRECTS) {
        throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`);
      }
      url = validatePublicUrl(new URL(location, url).toString());
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const text =
      contentType.includes("html") || looksLikeHtml(body) ? htmlToText(body) : body;

    if (text.length > maxChars) {
      return `${text.slice(0, maxChars)}\n\n(truncated at ${maxChars} characters)`;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export function validatePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http and https URLs are allowed");
  }
  assertPublicHost(url.hostname);
  return url;
}

export function assertPublicHost(hostname: string): void {
  const host = stripBrackets(hostname.toLowerCase());
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("local URLs are not allowed");
  }
  if (isIP(host) && isPrivateAddress(host)) {
    throw new Error("local or private network URLs are not allowed");
  }
}

async function assertResolvesPublic(hostname: string, lookup: LookupFn): Promise<void> {
  const host = stripBrackets(hostname.toLowerCase());
  if (isIP(host)) return;
  await resolvePublic(host, lookup);
}

async function resolvePublic(host: string, lookup: LookupFn): Promise<string[]> {
  const addresses = await lookup(host);
  if (addresses.length === 0) {
    throw new Error(`could not resolve ${host}`);
  }
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`${host} resolves to a private address (${address})`);
    }
  }
  return addresses;
}

/**
 * The socket connects to whatever this returns, so a DNS answer that changes
 * after the pre-check (rebinding) is still validated before any byte is sent.
 */
export function guardedLookup(lookup: LookupFn): LookupFunction {
  return (hostname, options, callback) => {
    resolvePublic(hostname, lookup).then(
      (addresses) => {
        const entries: LookupAddress[] = addresses
          .map((address) => ({ address, family: isIP(address) }))
          .filter((entry) => !options.family || entry.family === options.family);
        if (entries.length === 0) {
          callback(new Error(`could not resolve ${hostname}`), "", 0);
        } else if (options.all) {
          callback(null, entries);
        } else {
          callback(null, entries[0].address, entries[0].family);
        }
      },
      (error: Error) => callback(error, "", 0),
    );
  };
}

export function createPinnedFetch(lookup: LookupFn): typeof fetch {
  const pinnedLookup = guardedLookup(lookup);
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const transport = url.protocol === "https:" ? https : http;
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const request = transport.request(
        url,
        {
          method: init?.method ?? "GET",
          headers: { ...headers, "Accept-Encoding": "gzip, deflate, br" },
          lookup: isIP(stripBrackets(url.hostname)) ? undefined : pinnedLookup,
          agent: false,
          signal: init?.signal ?? undefined,
        },
        (incoming) => {
          const status = incoming.statusCode ?? 0;
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value === undefined) continue;
            for (const item of Array.isArray(value) ? value : [value]) {
              responseHeaders.append(name, item);
            }
          }
          const body = decompress(incoming, responseHeaders.get("content-encoding"));
          const chunks: Buffer[] = [];
          let size = 0;
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            responseHeaders.delete("content-encoding");
            const buffer = Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES);
            resolve(
              new Response(NULL_BODY_STATUSES.has(status) ? null : buffer, {
                status,
                headers: responseHeaders,
              }),
            );
          };
          const fail = (error: Error) => {
            if (done) return;
            done = true;
            reject(error);
          };
          body.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            size += chunk.length;
            if (size >= MAX_BODY_BYTES) {
              finish();
              incoming.destroy();
            }
          });
          body.on("end", finish);
          body.on("error", fail);
          incoming.on("error", fail);
        },
      );
      request.on("error", reject);
      request.end();
    });
}

function decompress(
  stream: http.IncomingMessage,
  encoding: string | null,
): NodeJS.ReadableStream {
  if (encoding === "gzip") return stream.pipe(zlib.createGunzip());
  if (encoding === "deflate") return stream.pipe(zlib.createInflate());
  if (encoding === "br") return stream.pipe(zlib.createBrotliDecompress());
  return stream;
}

export function isPrivateAddress(address: string): boolean {
  const ip = stripBrackets(address.toLowerCase());
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  if (isIP(ip) === 6) {
    if (ip === "::" || ip === "::1") return true;
    if (/^f[cd]/.test(ip)) return true;
    if (/^fe[89ab]/.test(ip)) return true;
    return false;
  }
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, "");
}

function looksLikeHtml(body: string): boolean {
  const sample = body.slice(0, 500).toLowerCase();
  return sample.includes("<html") || sample.includes("<!doctype");
}

export function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}
