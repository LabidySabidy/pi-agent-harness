/**
 * warmup.test.ts — the warm-up's request shape and its failure policy.
 *
 * The extension removes an 8-second cold load (measured on this machine: 8,046 ms cold vs 178 ms
 * warm) by pinning the model at session start with a long `keep_alive`. Two things about it are easy
 * to get wrong and invisible until they bite:
 *
 *   1. THE REQUEST SHAPE. `keep_alive` must be IN THE BODY — it is not a header, which is exactly why
 *      `models.json` cannot express it. A warm-up that omits it does nothing at all while appearing
 *      to run, because Ollama would answer normally and then unload after its default 5 minutes.
 *   2. THE FAILURE POLICY. Ollama is optional; a machine without it, or with it stopped, is fine.
 *      Any warning here is noise for a feature the user may not use, and an extension hook that
 *      throws at session_start would break EVERY session. So every failure is silent and the
 *      session still starts.
 *
 * A local HTTP stub is used rather than the real server: a test that needs Ollama installed fails
 * for reasons unrelated to the code under test.
 *
 * Run: node run-extension-tests.mjs   (from ~/.pi)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import ollamaWarmup from "./index.ts";

interface Captured {
  path: string;
  body: Record<string, unknown>;
}

/** A fake ExtensionAPI that records handlers, so the test can fire session_start itself. */
function fakePi() {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<void> | void>>();
  const logs: string[] = [];
  const api = {
    on(event: string, fn: (event: unknown, ctx: unknown) => Promise<void> | void) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    log: (message: string) => logs.push(message),
  };
  return {
    api: api as never,
    logs,
    async fire(event: string) {
      for (const fn of handlers.get(event) ?? []) await fn({}, {});
    },
  };
}

/**
 * Run the extension against a stub Ollama on an ephemeral port.
 *
 * `captured` is only complete once the server's 'end' handler has run, so the request is awaited
 * THROUGH the handler rather than raced against the fetch's response: `gotRequest` resolves from
 * inside the server, after the body is recorded.
 */
async function withStub(
  opts: { status?: number; crash?: boolean },
  fn: (baseUrl: string, captured: Captured[]) => Promise<Array<Promise<void>>>,
): Promise<void> {
  const captured: Captured[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        captured.push({ path: req.url ?? "", body: JSON.parse(raw || "{}") });
      } catch {
        captured.push({ path: req.url ?? "", body: {} });
      }
      if (opts.crash) {
        req.socket.destroy();
        return;
      }
      res.writeHead(opts.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${port}`, captured);
  } finally {
    // fetch keeps connections alive and server.close() waits on every socket, so without this the
    // suite hangs after the assertions have already passed.
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Drive the extension once and return everything observable.
 *
 * The env vars are the extension's documented seam and are read at call time, so they are set here
 * and cleared afterwards.
 */
async function run(
  opts: { status?: number; crash?: boolean; models?: string; keepAlive?: string },
): Promise<{ captured: Captured[]; logs: string[] }> {
  const pi = fakePi();
  ollamaWarmup(pi.api);
  const keys = ["OLLAMA_BASE_URL", "OLLAMA_WARMUP_MODELS", "OLLAMA_WARMUP_KEEP_ALIVE"] as const;
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  let captured: Captured[] = [];
  try {
    await withStub(opts, async (baseUrl, cap) => {
      process.env.OLLAMA_BASE_URL = baseUrl;
      delete process.env.OLLAMA_WARMUP_MODELS;
      delete process.env.OLLAMA_WARMUP_KEEP_ALIVE;
      if (opts.models !== undefined) process.env.OLLAMA_WARMUP_MODELS = opts.models;
      if (opts.keepAlive !== undefined) process.env.OLLAMA_WARMUP_KEEP_ALIVE = opts.keepAlive;
      await pi.fire("session_start");
      captured = cap;
      return [];
    });
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { captured, logs: pi.logs };
}

test("session_start sends keep_alive IN THE BODY, which is the whole point", async () => {
  // A warm-up that omitted keep_alive would answer 200 and do nothing, because Ollama would unload
  // after its default 5 minutes. So this asserts the field, not merely that a request happened.
  const { captured } = await run({});
  assert.equal(captured.length, 1, "exactly one warm request");
  assert.equal(captured[0].path, "/api/generate");
  assert.equal(captured[0].body.keep_alive, "10m");
  assert.equal(captured[0].body.model, "gemma4:e4b");
  assert.equal(captured[0].body.stream, false);
});

test("the warm request asks for ONE token, so it stays a cache warmer and not a completion", async () => {
  const { captured } = await run({});
  const options = captured[0].body.options as { num_predict?: number } | undefined;
  assert.equal(options?.num_predict, 1);
});

test("an unreachable Ollama is SILENT and does not throw (a session must still start)", async () => {
  // The failure that matters most: a machine without Ollama must see neither noise nor a broken
  // session.
  const pi = fakePi();
  ollamaWarmup(pi.api);
  const saved = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9"; // discard port, nothing listens
  try {
    await assert.doesNotReject(() => pi.fire("session_start"));
    assert.deepEqual(pi.logs, [], "no log line when nothing was warmed");
  } finally {
    if (saved === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = saved;
  }
});

test("a connection that drops mid-request is silent too", async () => {
  const { logs } = await run({ crash: true });
  assert.deepEqual(logs, []);
});

test("a 404 (model not pulled) is a skip, not a failure — and logs nothing", async () => {
  // The default list must not require every machine to have every model.
  const { logs } = await run({ status: 404 });
  assert.deepEqual(logs, []);
});

test("a 500 is silent as well: the warm-up never reports its own trouble", async () => {
  const { logs } = await run({ status: 500 });
  assert.deepEqual(logs, []);
});

test("a successful warm names the model and the hold time", async () => {
  const { logs } = await run({});
  assert.equal(logs.length, 1);
  assert.match(logs[0], /gemma4:e4b/);
  assert.match(logs[0], /10m/);
});

test("OLLAMA_WARMUP_MODELS overrides the list, and each model is warmed", async () => {
  const { captured, logs } = await run({ models: "a:1,b:2" });
  assert.equal(captured.length, 2, "one request per configured model");
  assert.deepEqual(
    captured.map((c) => c.body.model).sort(),
    ["a:1", "b:2"],
  );
  assert.match(logs[0], /a:1/);
  assert.match(logs[0], /b:2/);
});

test("OLLAMA_WARMUP_KEEP_ALIVE overrides the hold time", async () => {
  const { captured } = await run({ keepAlive: "30m" });
  assert.equal(captured[0].body.keep_alive, "30m");
});

test("a blank override falls back to the defaults rather than warming nothing", async () => {
  // `""` must behave like "unset": an empty string is what a half-configured env var looks like, and
  // warming nothing would be a silent no-op.
  const { captured } = await run({ models: "" });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].body.model, "gemma4:e4b");
});
