/**
 * ollama-warmup/index.ts — keep the local Ollama model resident so the first call is not a 8-second wait.
 *
 * WHY THIS EXISTS
 * A cold Ollama call loads the model from disk before it answers. Measured on this machine
 * (gemma4:e4b, `num_predict: 8`):
 *
 *     first call, model unloaded   8,046 ms
 *     second call, model warm        362 ms
 *     third call, model warm         192 ms
 *     warm after an explicit keep_alive  178 ms
 *
 * Ollama unloads an idle model after 5 minutes by default, so the 8s is paid once per idle gap —
 * which is exactly when a subagent is spawned, because spawning is something you do after thinking
 * for a while. Paying it inside the subagent's wall-clock budget is the worst place for it.
 *
 * WHAT IT DOES
 * One cheap request at session start with a long `keep_alive`, which pins the model in RAM. The
 * request is deliberately tiny (`num_predict: 1`) — this is a cache warmer, not a completion, so the
 * generated token is discarded and never reaches the model's context.
 *
 * WHY AN EXTENSION AND NOT A CONFIG VALUE
 * `keep_alive` is a REQUEST-BODY parameter, not a header, so `models.json` cannot carry it (the
 * provider schema has `baseUrl`, `api`, `apiKey`, `headers`, `models`, `modelOverrides` — no body
 * fields). The server-side alternative, the OLLAMA_KEEP_ALIVE environment variable, would hold the
 * model resident for every client at all times: gemma4:26b is ~17 GB, and idle RAM reserved all
 * evening is a worse trade than one short call when a session actually starts.
 *
 * FAILURE POLICY — never block, never throw, never warn on a healthy absence.
 * Ollama is optional. A machine without it, or with it stopped, is a perfectly good machine, and a
 * startup warning for a feature you are not using is noise that trains you to ignore startup output.
 * Every failure path here is silent and best-effort. The one thing it does do is LOG, at debug-ish
 * level via `pi.log`, so a mystery cold start can be diagnosed without re-adding a warning.
 *
 * WHY NOT `session_shutdown` TO UNLOAD
 * Deliberate omission. The keep-alive expires on its own, and unloading on shutdown would fight a
 * second Pi session that is still running — pi-web holds sessions open, so "shutdown" here does not
 * mean "nobody is using the model".
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Resolved PER CALL, not once at import.
 *
 * It was a module-level const, which is subtly wrong twice over: this extension cannot be pointed at
 * a different host without a process restart, and a test that sets OLLAMA_BASE_URL after importing
 * the module silently talks to the REAL Ollama instead of its stub. That second failure is how this
 * was found — the "unreachable Ollama" case logged a successful warm, because the request went to
 * the live server.
 */
function ollamaBase(): string {
  return process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
}

/**
 * How long to hold the model. 10 minutes is chosen over 30 because the cost of being wrong is
 * asymmetric: too short costs one 8s reload, too long holds gigabytes while you are away from the
 * keyboard. It comfortably covers a working stretch and a subagent run without pinning RAM all night.
 */
function keepAlive(): string {
  return process.env.OLLAMA_WARMUP_KEEP_ALIVE?.trim() || "10m";
}

/**
 * Models to warm, smallest first. e4b is the scout tier; 26b is warmed only if it is already pulled,
 * because loading a 17 GB model speculatively at every session start is not a "warm-up".
 * Override with OLLAMA_WARMUP_MODELS="a,b".
 */
const DEFAULT_MODELS = ["gemma4:e4b"];

/** A cold load can legitimately take 15s+; the warm-up must not outlive the session's patience. */
const TIMEOUT_MS = 30_000;

function modelsToWarm(): string[] {
  const override = process.env.OLLAMA_WARMUP_MODELS?.trim();
  if (override) {
    return override.split(",").map((m) => m.trim()).filter(Boolean);
  }
  return DEFAULT_MODELS;
}

async function warm(model: string): Promise<"warm" | "skipped" | "failed"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ollamaBase()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt: "warm",
        stream: false,
        keep_alive: keepAlive(),
        options: { num_predict: 1 },
      }),
    });
    // 404 means the model is not pulled on this machine. That is a "skipped", not a failure: the
    // default list should not require every machine to have every model.
    if (res.status === 404) return "skipped";
    if (!res.ok) return "failed";
    await res.body?.cancel();
    return "warm";
  } catch {
    // Connection refused (Ollama not running), abort, DNS, anything: all silent by design.
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

export default function ollamaWarmup(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    const models = modelsToWarm();
    const results = await Promise.all(models.map(async (m) => [m, await warm(m)] as const));
    const warmed = results.filter(([, r]) => r === "warm").map(([m]) => m);
    if (warmed.length > 0) {
      pi.log?.(`ollama-warmup: held ${warmed.join(", ")} for ${keepAlive()}`);
    }
    // No warning for skipped/failed. See FAILURE POLICY above — an absent Ollama is not a problem.
  });
}
