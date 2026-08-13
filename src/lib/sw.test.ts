import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Tests the shipped service worker, by loading `public/sw.js` itself.
 *
 * It is deliberately not a copy of the rules: the property under test is a
 * security property -- that a personalised response is never written to a cache
 * shared across a browser profile -- and a test of a duplicated predicate would
 * keep passing after the real file drifted away from it.
 *
 * The worker is a classic (non-module) script, so it can be evaluated against a
 * fake ServiceWorkerGlobalScope and its handlers captured.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "public", "sw.js"),
  "utf8",
);

interface Handlers {
  fetch?: (event: FakeFetchEvent) => void;
}

interface FakeFetchEvent {
  request: FakeRequest;
  respondWith: (p: unknown) => void;
  waitUntil: (p: unknown) => void;
  preloadResponse: Promise<undefined>;
}

interface FakeRequest {
  url: string;
  method: string;
  mode?: string;
  headers: { get: (k: string) => string | null };
}

function req(
  url: string,
  { method = "GET", mode = "cors", rsc = false }: { method?: string; mode?: string; rsc?: boolean } = {},
): FakeRequest {
  return {
    url,
    method,
    mode,
    headers: { get: (k: string) => (rsc && k === "RSC" ? "1" : null) },
  };
}

/** Evaluates sw.js against a fake global scope and returns what it registered. */
function loadWorker() {
  const handlers: Handlers = {};
  const opened: string[] = [];
  const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined), add: vi.fn(async () => undefined) };

  const scope = {
    location: { origin: "https://obolo.example" },
    addEventListener: (type: string, fn: unknown) => {
      (handlers as Record<string, unknown>)[type] = fn;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: { navigationPreload: { enable: async () => {} } },
    caches: {
      open: async (name: string) => {
        opened.push(name);
        return cache;
      },
      keys: async () => [],
      delete: async () => true,
    },
    fetch: vi.fn(async () => ({ ok: true, status: 200, clone: () => ({}) })),
    URL,
    Request: class {
      constructor(public input: string) {}
    },
    Response: class {
      constructor(public body: unknown, public init: unknown) {}
    },
  };

  const run = new Function(
    "self", "caches", "fetch", "URL", "Request", "Response",
    SOURCE,
  );
  run(scope, scope.caches, scope.fetch, URL, scope.Request, scope.Response);

  return { handlers, opened, cache, scope };
}

function dispatch(url: string, opts?: Parameters<typeof req>[1]) {
  const w = loadWorker();
  let responded: unknown = undefined;
  const event: FakeFetchEvent = {
    request: req(url, opts),
    respondWith: (p) => { responded = p; },
    waitUntil: () => {},
    preloadResponse: Promise.resolve(undefined),
  };
  w.handlers.fetch?.(event);
  return { ...w, responded, handled: responded !== undefined };
}

describe("service worker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers install, activate, fetch and message handlers", () => {
    const { handlers } = loadWorker();
    for (const type of ["install", "activate", "fetch", "message"]) {
      expect(handlers[type as keyof Handlers], `missing ${type} handler`).toBeTypeOf("function");
    }
  });

  // ---- the security property -------------------------------------------
  //
  // Every page in this app is personalised: the v_* views mask cost by role, so
  // one URL renders differently for an owner and for staff. A service worker
  // cache outlives a sign-out, so caching any of these would eventually serve
  // one person's cost figures to another on a shared device.

  it("never caches a document navigation", async () => {
    const { opened } = dispatch("https://obolo.example/", { mode: "navigate" });
    // It responds (to provide the offline fallback) but must not touch the
    // asset cache on the success path.
    expect(opened).not.toContain("obolo-assets-v1");
  });

  it("never caches an RSC payload requested by header", () => {
    const { handled } = dispatch("https://obolo.example/warehouse", { rsc: true });
    expect(handled).toBe(false);
  });

  it("never caches an RSC payload requested by query string", () => {
    const { handled } = dispatch("https://obolo.example/warehouse?_rsc=abc123");
    expect(handled).toBe(false);
  });

  it("never caches an API route", () => {
    for (const url of ["/api/agent", "/api/insights", "/api/vision", "/api/report-query"]) {
      expect(dispatch(`https://obolo.example${url}`).handled).toBe(false);
    }
  });

  it("ignores everything that is not a GET", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(dispatch("https://obolo.example/_next/static/chunks/a.js", { method }).handled).toBe(false);
    }
  });

  it("never caches another origin", () => {
    expect(dispatch("https://xyz.supabase.co/rest/v1/rpc/me").handled).toBe(false);
    expect(dispatch("https://xyz.supabase.co/auth/v1/user").handled).toBe(false);
  });

  // ---- what it should cache ---------------------------------------------

  it("caches content-hashed build assets", () => {
    for (const url of [
      "/_next/static/chunks/main-abc123.js",
      "/_next/static/css/abc123.css",
      "/_next/static/media/Archivo_var-s.p.1_q0qa17ptz5n.woff2",
    ]) {
      const { handled, opened } = dispatch(`https://obolo.example${url}`);
      expect(handled, `${url} should be handled`).toBe(true);
      expect(opened).toContain("obolo-assets-v1");
    }
  });

  it("caches the icons and the manifest", () => {
    for (const url of ["/icon-192.png", "/icon-maskable-512.png", "/manifest.webmanifest"]) {
      expect(dispatch(`https://obolo.example${url}`).handled, url).toBe(true);
    }
  });

  // A page URL with no extension and no RSC marker, fetched as a sub-resource
  // rather than a navigation, must still not be cached.
  it("does not cache a bare app path fetched as a sub-resource", () => {
    expect(dispatch("https://obolo.example/warehouse").handled).toBe(false);
    expect(dispatch("https://obolo.example/settings").handled).toBe(false);
  });
});
