const DEFAULT_MAX_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;

export type WebFetchOptions = {
  fetchImpl?: typeof fetch;
  maxChars?: number;
};

export async function fetchPublicUrl(
  rawUrl: string,
  options?: WebFetchOptions,
): Promise<string> {
  const url = validatePublicUrl(rawUrl);
  const fetchImpl = options?.fetchImpl ?? fetch;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/json,text/plain,*/*" },
    });
  } finally {
    clearTimeout(timer);
  }

  validatePublicUrl(response.url || url.toString());
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  let text = body;
  if (contentType.includes("html") || looksLikeHtml(body)) {
    text = htmlToText(body);
  }

  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}\n\n(truncated at ${maxChars} characters)`;
  }
  return text;
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
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) {
    throw new Error("local URLs are not allowed");
  }
  if (host === "127.0.0.1" || host.startsWith("127.")) {
    throw new Error("local URLs are not allowed");
  }
  if (host.startsWith("10.")) throw new Error("private network URLs are not allowed");
  if (host.startsWith("192.168.")) throw new Error("private network URLs are not allowed");
  if (host.startsWith("169.254.")) throw new Error("link-local URLs are not allowed");
  const match172 = /^172\.(\d+)\./.exec(host);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) {
      throw new Error("private network URLs are not allowed");
    }
  }
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
