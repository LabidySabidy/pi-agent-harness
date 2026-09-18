/**
 * telemetry — Pi extension
 *
 * Session-level telemetry with per-turn upserts and journal recovery.
 * Measures boot payload, cumulative token usage, skill invocations,
 * lesson citations, and gate results. All writes are append-only JSONL;
 * state tracking via .agent/telemetry-state.json.
 *
 * Fail-open: all operations wrapped in try/catch; errors logged to
 * .agent/telemetry-errors.log. A broken profiler must never take down
 * the car.
 *
 * Install at: ~/.pi/agent/extensions/telemetry/index.ts
 *
 * Fields (OTel + harness):
 *   gen_ai.usage.input_tokens          harness.usage.cache_read_tokens
 *   gen_ai.usage.output_tokens         harness.usage.cache_write_tokens
 *   gen_ai.usage.cost                  harness.boot.payload
 *   gen_ai.request.model               harness.lesson_hits
 *   harness.skills                     harness.gates
 *   harness.device                     harness.git_sha
 *   harness.estimator                  harness.session_id
 *   harness.project                    harness.session_file
 *   ts
 */

import type { ExtensionAPI, AgentEndEvent, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { promises as fs, existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { bucketMessages, charsToTokens, BUCKET_KEYS, type TokenBuckets } from "./buckets.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TELEMETRY_FILENAME = ".agent/telemetry.jsonl";
const STATE_FILENAME = ".agent/telemetry-state.json";
const ERRORS_FILENAME = ".agent/telemetry-errors.log";
const LESSON_STATS_FILENAME = "lesson-stats.json";
const GLOBAL_AGENT_DIR = join(os.homedir(), ".pi", "agent");
const HARNESS_ROOT = join(os.homedir(), ".pi");

const ESTIMATOR = "chars4"; // default: character count / 4
const GIT_LOG_BOOT_TOKENS = 200; // ~200 tokens for git log -20

// Files loaded per AGENTS.md session-start protocol.
// global:true entries resolve against HARNESS_ROOT (~/.pi);
// all others resolve against project cwd.
const PROTOCOL_FILES: Array<{ name: string; path: string[]; global?: boolean }> = [
  { name: "AGENTS.md (global)", path: ["agent", "AGENTS.md"], global: true },
  { name: "STANDARDS.md (global)", path: ["agent", "STANDARDS.md"], global: true },
  { name: "LESSONS.md (global)", path: ["agent", "LESSONS.md"], global: true },
  { name: "AGENTS.md (project)", path: ["AGENTS.md"] },
  { name: "STANDARDS.md (project)", path: ["STANDARDS.md"] },
  { name: "VISION.md", path: ["VISION.md"] },
  { name: "PROGRESS.md", path: ["PROGRESS.md"] },
  { name: "LESSONS.md (project)", path: ["LESSONS.md"] },
];

// Lesson citation regex: matches GL-001, L-042, etc.
const LESSON_CITE_RE = /\b(GL|L)-(\d{3})\b/g;

// Reserved non-lesson IDs that appear in header comments / examples
const RESERVED_NON_LESSON_IDS = new Set(["GL-000"]);

// Cache: valid lesson IDs parsed from LESSONS.md files (lazy, cleared per session)
let _validLessonIdsCache: Set<string> | null = null;

// Skill invocation regex: matches /skill:name patterns (letters + hyphens only, excludes backticks/parens/commas)
const SKILL_RE = /\/skill:([a-zA-Z][a-zA-Z0-9-]*)/g;

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface BootRecord {
  type: "boot";
  ts: string;
  "harness.session_id": string;
  "harness.project": string;
  "harness.device": string;
  "harness.git_sha": string;
  "harness.estimator": string;
  "harness.boot.payload": Record<string, number>;
  /** Which model record actually served this session, and where it came from. */
  "harness.model"?: HarnessModelInfo;
  /** Which pi build is running, and through which surface. */
  "harness.pi"?: HarnessPiInfo;
}

/**
 * Identity of the resolved model record.
 *
 * WHY: a session can silently resolve to a different catalog record than intended —
 * a stale bundled entry, a retired id, or a different price schedule. Nothing else
 * in telemetry records which record served a run, so a drift is invisible until the
 * cost is wrong. `source` and `pinned` are the fields that make a failed pin loud.
 */
export interface HarnessModelInfo {
  id: string;
  name?: string;
  provider?: string;
  /** `image` in this list means the model accepts images; its absence means images are dropped. */
  input?: string[];
  contextWindow?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  /** Where the record came from: a local models.json override, the remote/cached
   *  catalog, or the version-bundled catalog. `bundled` with an unexpected id is
   *  the signature of the silent-drift failure. */
  source: "override" | "cache" | "bundled" | "unknown";
  /** Timestamp of the cached catalog body that supplied it, when known. */
  catalogLastModified?: string;
  /** True when a local models.json supplies an override for this model id. */
  pinned: boolean;
}

export interface HarnessPiInfo {
  version: string;
  surface: "cli" | "pi-web" | "unknown";
}

interface RunningRecord {
  type: "running";
  ts: string;
  "harness.session_id": string;
  "harness.project": string;
  "harness.device": string;
  "harness.estimator": string;
  "gen_ai.request.model": string;
  "gen_ai.usage.input_tokens": number;
  "gen_ai.usage.output_tokens": number;
  "gen_ai.usage.cost": number;
  "harness.usage.cache_read_tokens": number;
  "harness.usage.cache_write_tokens": number;
  "harness.lesson_hits": string[];
  "harness.skills": string[];
  "harness.gates": string; // "pass" | "fail" | "unknown"
  /** Monotonic count of model exchanges (turn_end) in the session. */
  turn_index: number;
  /** Monotonic count of user prompts in the session. */
  user_turns: number;
  /** Off-peak-adjusted spend estimate (USD) at catalog rates. */
  cost_offpeak_adjusted?: number;
}

interface SessionEndRecord {
  type: "session_end";
  ts: string;
  "harness.session_id": string;
  "harness.project": string;
  "gen_ai.usage.input_tokens": number;
  "gen_ai.usage.output_tokens": number;
  "gen_ai.usage.cost": number;
  "harness.usage.cache_read_tokens": number;
  "harness.usage.cache_write_tokens": number;
  "harness.lesson_hits": string[];
  "harness.skills": string[];
  "harness.gates": string;
  turn_count: number;
  /** Count of user prompts, distinct from the model-exchange turn count. */
  user_turns: number;
  /** Off-peak-adjusted spend estimate (USD) at catalog rates. */
  cost_offpeak_adjusted: number;
}

interface TelemetryState {
  currentSessionId: string | null;
  previousSessionId: string | null;
  previousSessionFile: string | null;
  previousSessionProject: string | null;
  projectKey: string;
  cumulative: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
    lessonHits: string[];
    skills: string[];
    gates: string;
    models: string[];
    turnIndex: number;
    /** Count of user prompts (message_start with role === "user"), monotonic. */
    userTurns: number;
    /** Cost with the DeepSeek off-peak discount applied; the spend estimate. */
    adjustedCost: number;
    /** True once the cost warning has fired, so it fires at most once per session. */
    warnedCost: boolean;
  };
}

interface LessonStatsEntry {
  hits: number;
  last_used: string | null;
  device_last_hit: string | null;
  added: string;
  category: string;
}

interface LessonStatsFile {
  [lessonId: string]: LessonStatsEntry;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-session state (module-level — one extension instance per session)
// ─────────────────────────────────────────────────────────────────────────

let sessionId: string | null = null;
let sessionFile: string | null = null;
let projectDir: string | null = null;
let deviceName: string | null = null;
let harnessGitSha: string | null = null;
let state: TelemetryState | null = null;

// ── Token accounting (Pass 5) ──────────────────────────────────────────
let lastBuckets: TokenBuckets | null = null;
let systemPromptTokens = 0;
let contextFilesTokens = 0;
let skillsTokens = 0;
let lastProviderUsage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number } | null = null;

/** Extract LLM-facing messages from the current session branch (for /tokens). */
function sessionMessages(ctx: any): unknown[] {
  try {
    // `buildContextEntries` does not exist in any released pi (verified against
    // 0.80.3 and 0.84.3); optional chaining made it return [] silently, so /tokens
    // reported all-zero layers before the first request of a session. The real
    // method is `buildSessionContext()`, whose result carries `.messages`.
    const built = ctx?.sessionManager?.buildSessionContext?.();
    const entries = built?.messages ?? [];    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function makeSessionId(): string {
  // UUIDv4-ish: random hex, enough for uniqueness within a device
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function normalizeProjectPath(cwd: string): string {
  // Resolve 8.3 short names and symlinks; normalize drive letter casing
  try {
    const resolved = resolve(cwd);
    return resolved.replace(/\\/g, "/").toLowerCase();
  } catch {
    return cwd.replace(/\\/g, "/").toLowerCase();
  }
}

async function getGitSha(): Promise<string> {
  try {
    const { execSync } = await import("node:child_process");
    const result = execSync("git rev-parse --short HEAD", {
      cwd: HARNESS_ROOT,
      encoding: "utf8",
      timeout: 5000,
    });
    return result.trim();
  } catch {
    return "unknown";
  }
}

function estimateTokens(text: string): number {
  // chars/4 estimator — conservative, fast, no model call
  return Math.max(1, Math.ceil(text.length / 4));
}

// ─────────────────────────────────────────────────────────────────────────
// Boot payload measurement
// ─────────────────────────────────────────────────────────────────────────

async function measureBootPayload(cwd: string): Promise<Record<string, number>> {
  const payload: Record<string, number> = {};
  payload["git log -20 (estimate)"] = GIT_LOG_BOOT_TOKENS;

  for (const file of PROTOCOL_FILES) {
    try {
      const base = file.global ? HARNESS_ROOT : cwd;
      const filePath = join(base, ...file.path);
      let content: string;
      if (file.name === "PROGRESS.md") {
        // Protocol reads first 50 lines only — measure what's actually loaded
        const full = await fs.readFile(filePath, "utf8");
        const lines = full.split("\n");
        content = lines.slice(0, 50).join("\n");
      } else {
        content = await fs.readFile(filePath, "utf8");
      }
      payload[file.name] = estimateTokens(content);
    } catch {
      // File doesn't exist — this is normal (most projects lack some protocol files)
      payload[file.name] = 0; // not loaded
    }
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────
// Journal recovery
// ─────────────────────────────────────────────────────────────────────────

async function recoverJournal(
  telemetryPath: string,
  statePath: string,
  prevSessionId: string,
  prevProject: string,
): Promise<void> {
  try {
    // Check if the previous session already has a session_end record
    const content = await fs.readFile(telemetryPath, "utf8");
    const lines = content.trim().split("\n");

    // Find the last line for prevSessionId
    let lastLine: string | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const record = JSON.parse(lines[i]);
        if (record["harness.session_id"] === prevSessionId) {
          lastLine = lines[i];
          break;
        }
      } catch { /* skip malformed lines */ }
    }

    if (!lastLine) return; // No records for this session — nothing to recover

    const record = JSON.parse(lastLine);
    if (record.type === "session_end") return; // Already finalized

    // Extract cumulative stats from the last running record
    const endRecord: SessionEndRecord = {
      type: "session_end",
      ts: isoNow(),
      "harness.session_id": prevSessionId,
      "harness.project": prevProject,
      "gen_ai.usage.input_tokens": record["gen_ai.usage.input_tokens"] ?? 0,
      "gen_ai.usage.output_tokens": record["gen_ai.usage.output_tokens"] ?? 0,
      "gen_ai.usage.cost": record["gen_ai.usage.cost"] ?? 0,
      "harness.usage.cache_read_tokens": record["harness.usage.cache_read_tokens"] ?? 0,
      "harness.usage.cache_write_tokens": record["harness.usage.cache_write_tokens"] ?? 0,
      "harness.lesson_hits": record["harness.lesson_hits"] ?? [],
      "harness.skills": record["harness.skills"] ?? [],
      "harness.gates": record["harness.gates"] ?? "unknown",
      turn_count: record.turn_index ?? 0,
      // Carry the new fields through recovery so a recovered session is not the one
      // place where user_turns / adjusted cost silently read as zero.
      user_turns: record.user_turns ?? 0,
      cost_offpeak_adjusted: record.cost_offpeak_adjusted ?? 0,
    };

    await appendLine(telemetryPath, JSON.stringify(endRecord));
  } catch {
    // File might not exist — no recovery needed
  }
}

// ─────────────────────────────────────────────────────────────────────────
// File I/O helpers
// ─────────────────────────────────────────────────────────────────────────

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch { /* ignore */ }
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await ensureDir(join(filePath, ".."));
  await fs.appendFile(filePath, line + "\n", "utf8");
}

async function readState(filePath: string): Promise<TelemetryState | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as TelemetryState;
  } catch {
    return null;
  }
}

async function writeState(filePath: string, s: TelemetryState): Promise<void> {
  await ensureDir(join(filePath, ".."));
  await fs.writeFile(filePath, JSON.stringify(s, null, 2) + "\n", "utf8");
}

function freshCumulative(): TelemetryState["cumulative"] {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    lessonHits: [],
    skills: [],
    gates: "unknown",
    models: [],
    turnIndex: 0,
    userTurns: 0,
    adjustedCost: 0,
    warnedCost: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Lesson citation extraction
// ─────────────────────────────────────────────────────────────────────────

function extractLessonCitations(text: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(LESSON_CITE_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const id = `${match[1]}-${match[2]}`;
    if (!RESERVED_NON_LESSON_IDS.has(id)) {
      ids.add(id);
    }
  }
  re.lastIndex = 0;
  return [...ids];
}

function extractSkills(text: string): string[] {
  const skills = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(SKILL_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    skills.add(match[1]);
  }
  re.lastIndex = 0;
  return [...skills];
}



// ─────────────────────────────────────────────────────────────────────────
// Text extraction from messages
// ─────────────────────────────────────────────────────────────────────────

function extractMessageText(msg: { role?: string; content?: unknown }): string {
  if (!msg.content) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((block: any) => {
        if (typeof block === "string") return block;
        if (block?.type === "text" || (!block?.type && block?.text)) {
          return block.text ?? "";
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────────
// Valid lesson ID resolution
// ─────────────────────────────────────────────────────────────────────────

async function loadValidLessonIds(projectDir: string): Promise<Set<string>> {
  if (_validLessonIdsCache) return _validLessonIdsCache;

  const ids = new Set<string>();
  const RE = /\b(GL|L)-(\d{3})\b/g;

  const files = [
    join(GLOBAL_AGENT_DIR, "LESSONS.md"),
    join(projectDir, "LESSONS.md"),
  ];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      let match: RegExpExecArray | null;
      while ((match = RE.exec(content)) !== null) {
        ids.add(`${match[1]}-${match[2]}`);
      }
      RE.lastIndex = 0;
    } catch {
      /* file may not exist */
    }
  }

  _validLessonIdsCache = ids;
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────
// Lesson stats maintenance
// ─────────────────────────────────────────────────────────────────────────

async function updateLessonStats(
  lessonIds: string[],
  projectDir: string,
): Promise<void> {
  if (lessonIds.length === 0) return;

  const validIds = await loadValidLessonIds(projectDir);
  const now = isoNow();
  const device = deviceName ?? os.hostname();

  for (const id of lessonIds) {
    // Defense in depth: skip reserved IDs and non-existent lessons
    if (RESERVED_NON_LESSON_IDS.has(id)) continue;
    if (!validIds.has(id)) continue;

    const isGlobal = id.startsWith("GL-");
    const statsDir = isGlobal ? GLOBAL_AGENT_DIR : join(projectDir, ".agent");
    const statsPath = join(statsDir, LESSON_STATS_FILENAME);

    try {
      await ensureDir(statsDir);
      let stats: LessonStatsFile = {};
      try {
        const raw = await fs.readFile(statsPath, "utf8");
        stats = JSON.parse(raw);
      } catch { /* file doesn't exist yet */ }

      const existing = stats[id];
      const entry: LessonStatsEntry = existing
        ? {
            ...existing,
            hits: existing.hits + 1,
            last_used: now,
            device_last_hit: device,
          }
        : {
            hits: 1,
            last_used: now,
            device_last_hit: device,
            added: now,
            category: "unknown",
          };

      stats[id] = entry;
      await fs.writeFile(statsPath, JSON.stringify(stats, null, 2) + "\n", "utf8");
    } catch {
      // Fail-open: stats are non-critical
    }
  }
}

/**
 * Describe the resolved model record and where it came from.
 *
 * `ctx.model` is the model the session runtime actually bound, so its identity is
 * authoritative. `source`/`pinned` are read from the two local files that can
 * change a record: `models.json` (a local override) and `models-store.json` (the
 * cached remote catalog). A record present in neither came from the bundled set.
 */
function describeModel(ctx: any): HarnessModelInfo | undefined {
  const model = ctx?.model ?? ctx?.modelRegistry?.getModel?.();
  if (!model) return undefined;

  const id = String(model.id ?? "unknown");
  const provider = model.provider ? String(model.provider) : undefined;

  let pinned = false;
  let inCache = false;
  let catalogLastModified: string | undefined;

  try {
    const modelsConfigPath = join(GLOBAL_AGENT_DIR, "models.json");
    if (existsSync(modelsConfigPath)) {
      const cfg = JSON.parse(readFileSync(modelsConfigPath, "utf8"));
      const prov = provider ? cfg?.providers?.[provider] : undefined;
      if (prov?.modelOverrides?.[id] || prov?.models?.some?.((m: any) => m?.id === id)) {
        pinned = true;
      }
    }
    const storePath = join(GLOBAL_AGENT_DIR, "models-store.json");
    if (existsSync(storePath)) {
      const store = JSON.parse(readFileSync(storePath, "utf8"));
      const entry = provider ? store?.[provider] : undefined;
      if (entry?.models?.some?.((m: any) => m?.id === id)) {
        inCache = true;
        if (typeof entry.lastModified === "number") {
          catalogLastModified = new Date(entry.lastModified).toISOString();
        }
      }
    }
  } catch {
    // Identity still gets recorded even when the local files cannot be read.
  }

  return {
    id,
    ...(model.name ? { name: String(model.name) } : {}),
    ...(provider ? { provider } : {}),
    ...(Array.isArray(model.input) ? { input: model.input.map(String) } : {}),
    ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
    ...(model.cost ? { cost: model.cost } : {}),
    source: pinned ? "override" : inCache ? "cache" : "bundled",
    ...(catalogLastModified ? { catalogLastModified } : {}),
    pinned,
  };
}

/**
 * Identify the pi build and surface.
 *
 * There is no version getter on the extension API, and `PI_MODEL`/`PI_PROVIDER`
 * are injected only into bash CHILD environments (core/tools/bash.js), so they are
 * absent from the pi process and cannot be read here. The version is therefore read
 * from the installed package's own manifest, and the surface from markers the host
 * sets: pi-web is a Next.js server, so `NEXT_RUNTIME` is present there and not in
 * the CLI. Anything unrecognised is recorded as `unknown` rather than guessed.
 */
function describePi(): HarnessPiInfo {
  let version = "unknown";

  const readVersionFrom = (start: string): string | undefined => {
    let dir = start;
    for (let i = 0; i < 12; i++) {
      const manifest = join(dir, "package.json");
      try {
        if (existsSync(manifest)) {
          const pkg = JSON.parse(readFileSync(manifest, "utf8"));
          if (pkg?.name === "@earendil-works/pi-coding-agent" && pkg.version) {
            return String(pkg.version);
          }
        }
      } catch {
        // keep walking
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
    return undefined;
  };

  // The pi package is NOT an ancestor of the extension (the extension lives in
  // ~/.pi/agent/extensions while pi is installed elsewhere), so an ancestor walk
  // from this file never reaches it. Resolve the module instead, then read the
  // manifest next to it. GL-017: resolve the package root, never a subpath.
  try {
    const resolveFn = (import.meta as unknown as { resolve?: (s: string) => string }).resolve;
    if (typeof resolveFn === "function") {
      const url = resolveFn("@earendil-works/pi-coding-agent");
      if (url?.startsWith("file:")) {
        version = readVersionFrom(dirname(fileURLToPath(url))) ?? version;
      }
    }
  } catch {
    // fall through to the argv-based probe
  }

  // CLI fallback: `node <pkg>/dist/cli.js` — walk up from the entry point.
  if (version === "unknown") {
    const entry = process.argv?.[1];
    if (entry) version = readVersionFrom(dirname(resolve(entry))) ?? version;
  }

  if (version === "unknown") {
    const pkgDir = process.env.PI_PACKAGE_DIR;
    if (pkgDir) version = readVersionFrom(resolve(pkgDir)) ?? version;
  }

  const surface: HarnessPiInfo["surface"] =
    process.env.NEXT_RUNTIME || process.env.PI_WEB_SURFACE
      ? "pi-web"
      : process.env.PI_CODING_AGENT
        ? "cli"
        : "unknown";

  return { version, surface };
}

/**
 * DeepSeek peak / off-peak billing (see weekly-report/pricing.ts for the full rationale).
 * The catalog `cost` is the PEAK rate; off-peak is exactly half, applied to all hours
 * outside Mon-Fri 01:00-04:00 and 06:00-10:00 UTC.
 */
function offPeakMultiplier(ts: string | number | Date): number {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return 1;
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return 0.5;
  const h = d.getUTCHours();
  const peak = (h >= 1 && h < 4) || (h >= 6 && h < 10);
  return peak ? 1 : 0.5;
}

/** Warn once per session when the off-peak-adjusted cost estimate crosses this. */
const SESSION_COST_WARN_USD = 0.5;

// ─────────────────────────────────────────────────────────────────────────
// Error logging
// ─────────────────────────────────────────────────────────────────────────

async function logError(projectDir: string, message: string): Promise<void> {
  try {
    const errorsPath = join(projectDir, ERRORS_FILENAME);
    const line = `[${isoNow()}] ${message}`;
    await appendLine(errorsPath, line);
  } catch {
    // Last resort: can't even log the error
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Telemetry target path resolution
// ─────────────────────────────────────────────────────────────────────────

async function getTelemetryTarget(cwd: string): Promise<{
  telemetryPath: string;
  statePath: string;
  projectKey: string;
  shouldWrite: boolean;
}> {
  const normalized = normalizeProjectPath(cwd);
  const isHarnessSession = normalized === normalizeProjectPath(HARNESS_ROOT);

  if (isHarnessSession) {
    // Harness's own sessions → ~/.pi/.agent/telemetry.jsonl
    return {
      telemetryPath: join(HARNESS_ROOT, TELEMETRY_FILENAME),
      statePath: join(HARNESS_ROOT, STATE_FILENAME),
      projectKey: "harness",
      shouldWrite: true,
    };
  }

  // Project sessions: only create .agent/ if project already has one
  // or has memory files (VISION.md, LESSONS.md, PROGRESS.md, PLAN.md)
  const agentDir = join(cwd, ".agent");
  let hasAgentDir = false;
  try {
    await fs.access(agentDir);
    hasAgentDir = true;
  } catch { /* no .agent/ */ }

  let hasMemoryFiles = false;
  if (!hasAgentDir) {
    for (const f of ["VISION.md", "LESSONS.md", "PROGRESS.md", "PLAN.md"]) {
      try {
        await fs.access(join(cwd, f));
        hasMemoryFiles = true;
        break;
      } catch { /* continue */ }
    }
  }

  return {
    telemetryPath: join(cwd, TELEMETRY_FILENAME),
    statePath: join(cwd, STATE_FILENAME),
    projectKey: normalized,
    shouldWrite: hasAgentDir || hasMemoryFiles,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Extension entry point
// ─────────────────────────────────────────────────────────────────────────

export default function telemetry(pi: ExtensionAPI) {
  // ── session_start ────────────────────────────────────────────────────
  pi.on("session_start", async (event: any, ctx: any) => {
    try {
      // Initialize per-session state
      deviceName = deviceName ?? os.hostname();
      harnessGitSha = harnessGitSha ?? (await getGitSha());
      sessionId = makeSessionId();
      sessionFile = event?.previousSessionFile ?? null;

      const { telemetryPath, statePath, projectKey, shouldWrite } =
        await getTelemetryTarget(ctx.cwd);
      projectDir = ctx.cwd;
      state = await readState(statePath);

      // Journal recovery: finalize previous session if needed.
      // Guard on currentSessionId (which IS the previous session from
      // the perspective of this boot), not previousSessionId (which the
      // first session always writes as null).
      if (state?.currentSessionId && state.projectKey) {
        await recoverJournal(
          telemetryPath,
          statePath,
          state.currentSessionId,
          state.projectKey,
        ).catch(() => {});
      }

      // Set up fresh state for this session
      const prevId = state?.currentSessionId ?? null;

      state = {
        currentSessionId: sessionId,
        previousSessionId: prevId,
        previousSessionFile: sessionFile,
        previousSessionProject: projectKey,
        projectKey,
        cumulative: freshCumulative(),
      };
      await writeState(statePath, state);

      // Reset token accounting for the new session.
      lastBuckets = null;
      systemPromptTokens = 0;
      contextFilesTokens = 0;
      skillsTokens = 0;
      lastProviderUsage = null;

      if (!shouldWrite) return; // Don't scaffold into bare projects

      // Measure boot payload
      const bootPayload = await measureBootPayload(ctx.cwd);

      const bootRecord: BootRecord = {
        type: "boot",
        ts: isoNow(),
        "harness.session_id": sessionId,
        "harness.project": projectKey,
        "harness.device": deviceName,
        "harness.git_sha": harnessGitSha,
        "harness.estimator": ESTIMATOR,
        "harness.boot.payload": bootPayload,
        "harness.model": describeModel(ctx),
        "harness.pi": describePi(),
      };

      await appendLine(telemetryPath, JSON.stringify(bootRecord));
    } catch (err) {
      if (projectDir) {
        await logError(
          projectDir,
          `session_start: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
      }
    }
  });

  // ── turn_end ────────────────────────────────────────────────────────
  // Primary per-turn telemetry. Fires after every LLM response + tool
  // execution cycle, regardless of whether more turns follow.
  pi.on("turn_end", async (event: TurnEndEvent, ctx: any) => {
    try {
      if (!state || !state.currentSessionId || !projectDir) return;

      const { telemetryPath, statePath, shouldWrite } =
        await getTelemetryTarget(projectDir);
      if (!shouldWrite) return;

      // Reload state from disk (handles concurrent updates)
      const currentState = await readState(statePath);
      if (!currentState || currentState.currentSessionId !== sessionId) {
        // Session was replaced — reload state
        state = currentState;
        if (!state || !state.currentSessionId) return;
      }

      const msg = event.message as any;
      if (!msg || msg.role !== "assistant") return;

      // ── Token usage ────────────────────────────────────────────────
      const usage = msg.usage;
      let cumulativeInput = state.cumulative.inputTokens;
      let cumulativeOutput = state.cumulative.outputTokens;
      let cumulativeCacheRead = state.cumulative.cacheReadTokens;
      let cumulativeCacheWrite = state.cumulative.cacheWriteTokens;
      let cumulativeCost = state.cumulative.cost || 0;

      if (usage) {
        cumulativeInput += usage.input ?? 0;
        cumulativeOutput += usage.output ?? 0;
        cumulativeCacheRead += usage.cacheRead ?? 0;
        cumulativeCacheWrite += usage.cacheWrite ?? 0;
        // cost is { input, output, cacheRead, cacheWrite } — sum for total
        const c = usage.cost as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined;
        if (c) {
          cumulativeCost += (c.input ?? 0) + (c.output ?? 0) + (c.cacheRead ?? 0) + (c.cacheWrite ?? 0);
        }
      }

      // ── Model ──────────────────────────────────────────────────────
      const models = new Set(state.cumulative.models);
      if (msg.model) models.add(msg.model);
      const model = msg.model ?? ([...models].slice(-1)[0] ?? "unknown");

      // ── Pattern scanning (citations / skills) ─────────────────────
      const rawText = extractMessageText(msg);

      const turnCitations = extractLessonCitations(rawText);
      const lessonIds = new Set(state.cumulative.lessonHits);
      for (const id of turnCitations) lessonIds.add(id);

      const skills = new Set(state.cumulative.skills);
      for (const skill of extractSkills(rawText)) skills.add(skill);

      // ── Turn index ─────────────────────────────────────────────────
      // MONOTONIC per session. Do NOT derive this from `event.turnIndex`: pi resets
      // its counter to 0 on every `agent_start` (agent-session.js _emitExtensionEvent),
      // and `agent_start` fires again for retries, auto-compaction, and queued
      // continuations. Using the event's index made a 49-turn session record as 2.
      // This counts MODEL EXCHANGES; `user_turns` counts the human's prompts.
      const turnIndex = state.cumulative.turnIndex + 1;

      // ── Off-peak-adjusted cost estimate (B5/B6) ────────────────────
      // Increment, not the cumulative total: only the increment has a single
      // timestamp, and peak/off-peak depends on the time of day.
      const priorCost = state.cumulative.cost || 0;
      const turnCost = Math.max(0, cumulativeCost - priorCost);
      const adjustedCost =
        (state.cumulative.adjustedCost || 0) + turnCost * offPeakMultiplier(isoNow());
      let warnedCostNow = state.cumulative.warnedCost === true;

      // ── Write running record ───────────────────────────────────────
      const record: RunningRecord = {
        type: "running",
        ts: isoNow(),
        "harness.session_id": state.currentSessionId,
        "harness.project": state.projectKey,
        "harness.device": deviceName ?? os.hostname(),
        "harness.estimator": usage ? "api" : "chars4",
        "gen_ai.request.model": model,
        "gen_ai.usage.input_tokens": cumulativeInput,
        "gen_ai.usage.output_tokens": cumulativeOutput,
        "gen_ai.usage.cost": cumulativeCost,
        "harness.usage.cache_read_tokens": cumulativeCacheRead,
        "harness.usage.cache_write_tokens": cumulativeCacheWrite,
        "harness.lesson_hits": [...lessonIds].sort(),
        "harness.skills": [...skills].sort(),
        "harness.gates": "unknown",
        turn_index: turnIndex,
        user_turns: state.cumulative.userTurns,
        // Off-peak-adjusted spend estimate for this session so far.
        cost_offpeak_adjusted: Number(adjustedCost.toFixed(6)),
      };

      // Update state
      state.cumulative = {
        inputTokens: cumulativeInput,
        outputTokens: cumulativeOutput,
        cacheReadTokens: cumulativeCacheRead,
        cacheWriteTokens: cumulativeCacheWrite,
        cost: cumulativeCost,
        lessonHits: [...lessonIds],
        skills: [...skills],
        gates: "unknown",
        models: [...models],
        turnIndex,
        userTurns: state.cumulative.userTurns,
        adjustedCost,
        warnedCost: warnedCostNow,
      };
      await writeState(statePath, state);

      // Append running record
      await appendLine(telemetryPath, JSON.stringify(record));

      // ── B6: one quiet cost warning per session ─────────────────────
      // Keyed to spend, not to a context percentage: compaction now fires at 60% of the
      // window, so a 70% context warning would rarely be reachable — and for someone who
      // does not read /tokens, dollars are the number that matters.
      if (!warnedCostNow && adjustedCost >= SESSION_COST_WARN_USD) {
        warnedCostNow = true;
        state.cumulative = { ...state.cumulative, warnedCost: true };
        await writeState(statePath, state);
        try {
          ctx?.ui?.notify?.(
            `Session cost estimate passed $${SESSION_COST_WARN_USD.toFixed(2)} ` +
              `(now ~$${adjustedCost.toFixed(2)} across ${turnIndex} model exchanges). ` +
              `Off-peak-adjusted at catalog rates; the provider's usage page is authoritative.`,
            "warning",
          );
        } catch {
          // No UI in non-interactive modes; the record above still carries the number.
        }
      }

      // Update lesson stats (per-turn delta only)
      await updateLessonStats(turnCitations, projectDir).catch(() => {});
    } catch (err) {
      if (projectDir) {
        await logError(
          projectDir,
          `turn_end: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
      }
    }
  });

  // ── agent_end ────────────────────────────────────────────────────────
  // Fallback finalizer. In most sessions turn_end captures everything;
  // this handles the edge case where the agent finishes with a text-only
  // response (no tool calls → no turn_end).
  pi.on("agent_end", async (event: AgentEndEvent, ctx: any) => {
    try {
      if (!state || !state.currentSessionId || !projectDir) return;

      const { telemetryPath, statePath, shouldWrite } =
        await getTelemetryTarget(projectDir);
      if (!shouldWrite) return;

      // Reload state from disk
      const currentState = await readState(statePath);
      if (!currentState || currentState.currentSessionId !== sessionId) {
        state = currentState;
        if (!state || !state.currentSessionId) return;
      }

      const messages = event?.messages ?? [];

      // Extract text from messages (nested shape: msg.message.role, msg.message.usage)
      let newText = "";
      let cumulativeInput = state.cumulative.inputTokens;
      let cumulativeOutput = state.cumulative.outputTokens;
      let cumulativeCacheRead = state.cumulative.cacheReadTokens;
      let cumulativeCacheWrite = state.cumulative.cacheWriteTokens;
      let cumulativeCost = state.cumulative.cost || 0;
      const lessonIds = new Set(state.cumulative.lessonHits);
      const skills = new Set(state.cumulative.skills);
      const models = new Set(state.cumulative.models);
      let sawUsage = false;

      for (const entry of messages) {
        const inner = (entry as any).message ?? entry;
        const role = inner.role;
        if (role !== "assistant") continue;

        const usage = inner.usage;
        if (usage) {
          sawUsage = true;
          cumulativeInput += usage.input ?? 0;
          cumulativeOutput += usage.output ?? 0;
          cumulativeCacheRead += usage.cacheRead ?? 0;
          cumulativeCacheWrite += usage.cacheWrite ?? 0;
          const c = usage.cost as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined;
          if (c) {
            cumulativeCost += (c.input ?? 0) + (c.output ?? 0) + (c.cacheRead ?? 0) + (c.cacheWrite ?? 0);
          }
        }
        if (inner.model) models.add(inner.model);

        const text = extractMessageText(inner);
        newText += text + "\n";
      }

      const agentEndCitations = extractLessonCitations(newText);
      for (const id of agentEndCitations) lessonIds.add(id);
      for (const skill of extractSkills(newText)) skills.add(skill);

      // Only write if turn_end never ran this session. turn_end fires after
      // every LLM response and already owns the cumulative totals; re-accumulating
      // all messages here would double-count input/output/cacheRead/cost.
      if (state.cumulative.turnIndex > 0) {
        return;
      }

      const newTurn = (state.cumulative.turnIndex ?? 0) + 1;
      const model = models.size > 0 ? [...models].slice(-1)[0] : "unknown";

      const record: RunningRecord = {
        type: "running",
        ts: isoNow(),
        "harness.session_id": state.currentSessionId,
        "harness.project": state.projectKey,
        "harness.device": deviceName ?? os.hostname(),
        "harness.estimator": sawUsage ? "api" : "chars4",
        "gen_ai.request.model": model,
        "gen_ai.usage.input_tokens": cumulativeInput,
        "gen_ai.usage.output_tokens": cumulativeOutput,
        "gen_ai.usage.cost": cumulativeCost,
        "harness.usage.cache_read_tokens": cumulativeCacheRead,
        "harness.usage.cache_write_tokens": cumulativeCacheWrite,
        "harness.lesson_hits": [...lessonIds].sort(),
        "harness.skills": [...skills].sort(),
        "harness.gates": "unknown",
        turn_index: newTurn,
        user_turns: state.cumulative.userTurns,
        cost_offpeak_adjusted: Number(
          (
            (state.cumulative.adjustedCost || 0) +
            Math.max(0, cumulativeCost - (state.cumulative.cost || 0)) * offPeakMultiplier(isoNow())
          ).toFixed(6),
        ),
      };

      state.cumulative = {
        inputTokens: cumulativeInput,
        outputTokens: cumulativeOutput,
        cacheReadTokens: cumulativeCacheRead,
        cacheWriteTokens: cumulativeCacheWrite,
        cost: cumulativeCost,
        lessonHits: [...lessonIds],
        skills: [...skills],
        gates: "unknown",
        models: [...models],
        turnIndex: newTurn,
        userTurns: state.cumulative.userTurns,
        adjustedCost:
          (state.cumulative.adjustedCost || 0) +
          Math.max(0, cumulativeCost - (state.cumulative.cost || 0)) * offPeakMultiplier(isoNow()),
        warnedCost: state.cumulative.warnedCost === true,
      };
      await writeState(statePath, state);
      await appendLine(telemetryPath, JSON.stringify(record));
      await updateLessonStats(agentEndCitations, projectDir).catch(() => {});
    } catch (err) {
      if (projectDir) {
        await logError(
          projectDir,
          `agent_end: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
      }
    }
  });

  // ── session_shutdown ─────────────────────────────────────────────────
  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    try {
      if (!state || !state.currentSessionId || !projectDir) return;

      const { telemetryPath, shouldWrite } = await getTelemetryTarget(projectDir);
      if (!shouldWrite) return;

      const endRecord: SessionEndRecord = {
        type: "session_end",
        ts: isoNow(),
        "harness.session_id": state.currentSessionId,
        "harness.project": projectDir,
        "gen_ai.usage.input_tokens": state.cumulative.inputTokens,
        "gen_ai.usage.output_tokens": state.cumulative.outputTokens,
        "gen_ai.usage.cost": state.cumulative.cost || 0,
        "harness.usage.cache_read_tokens": state.cumulative.cacheReadTokens,
        "harness.usage.cache_write_tokens": state.cumulative.cacheWriteTokens,
        "harness.lesson_hits": state.cumulative.lessonHits,
        "harness.skills": state.cumulative.skills,
        "harness.gates": state.cumulative.gates,
        turn_count: state.cumulative.turnIndex,
        user_turns: state.cumulative.userTurns,
        cost_offpeak_adjusted: Number((state.cumulative.adjustedCost || 0).toFixed(6)),
      };

      await appendLine(telemetryPath, JSON.stringify(endRecord));

      // ── B5: one-line session summary ───────────────────────────────
      // Cheap and quiet: the same numbers already in the record above, surfaced once
      // for someone who will never run /tokens or read the weekly report.
      try {
        if (ctx?.ui?.notify) {
          const cost = state.cumulative.adjustedCost || 0;
          const exchanges = state.cumulative.turnIndex;
          const prompts = state.cumulative.userTurns;
          ctx.ui.notify(
            `Session: ~$${cost.toFixed(2)} est. (off-peak adjusted) · ` +
              `${exchanges} model exchanges · ${prompts} prompts`,
            "info",
          );
        }
      } catch {
        // Non-interactive mode has no UI; the session_end record is the durable copy.
      }
    } catch (err) {
      if (projectDir) {
        await logError(
          projectDir,
          `session_shutdown: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
      }
    }
  });

  // ── context ────────────────────────────────────────────────────────
  // Read-only: bucket the request's messages by layer. Never returns modified
  // messages — returning them would break provider prompt caching.
  pi.on("context", (event: any) => {
    try {
      lastBuckets = bucketMessages(event?.messages ?? []);
    } catch {
      // fail-open
    }
  });

  // ── message_start ──────────────────────────────────────────────────
  // Count USER prompts. Distinct from `turn_index`, which counts model
  // exchanges: one user prompt spans several turns whenever tools run, and pi
  // re-enters its loop (retries, auto-compaction, queued continuations) without
  // a new user message. GL-018: never derive an exchange count from turn events.
  pi.on("message_start", (event: any) => {
    try {
      if (!state) return;
      if (event?.message?.role !== "user") return;
      state.cumulative = { ...state.cumulative, userTurns: state.cumulative.userTurns + 1 };
    } catch {
      // fail-open: a miscount must never break a turn
    }
  });

  // ── before_agent_start ─────────────────────────────────────────────
  // Size the system prompt and its context files / skills (per prompt).
  pi.on("before_agent_start", (event: any) => {
    try {
      systemPromptTokens = charsToTokens(event?.systemPrompt?.length ?? 0);
      const opts = event?.systemPromptOptions ?? {};
      let cf = 0;
      for (const f of opts.contextFiles ?? []) {
        cf += (f?.path?.length ?? 0) + (f?.content?.length ?? 0);
      }
      let sk = 0;
      for (const s of opts.skills ?? []) {
        sk += (s?.name?.length ?? 0) + (s?.description?.length ?? 0);
      }
      contextFilesTokens = charsToTokens(cf);
      skillsTokens = charsToTokens(sk);
    } catch {
      // fail-open
    }
  });

  // ── message_end ────────────────────────────────────────────────────
  // Record the provider's reported usage for calibration, and persist a
  // snapshot as a custom entry (excluded from the LLM context).
  pi.on("message_end", (event: any) => {
    try {
      const msg = event?.message;
      const usage = msg?.usage;
      if (usage) {
        lastProviderUsage = {
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
          totalTokens: usage.totalTokens ?? 0,
        };
      }
      // Snapshot once per assistant response (≈ once per turn), not for every
      // message — a long session otherwise appends thousands of custom entries.
      if (msg?.role === "assistant" && lastBuckets) {
        pi.appendEntry("tokens", {
          ts: isoNow(),
          systemPromptTokens,
          contextFilesTokens,
          skillsTokens,
          buckets: lastBuckets,
          providerUsage: lastProviderUsage,
        });
      }
    } catch {
      // fail-open
    }
  });

  // ── /tokens command ────────────────────────────────────────────────
  pi.registerCommand("tokens", {
    description:
      "Token accounting for the current session — per-layer estimates + calibration delta.",
    handler: async (_args: string, ctx: any) => {
      try {
        const usage = ctx.getContextUsage?.();
        const total = usage?.tokens ?? null;
        const win = usage?.contextWindow ?? 0;
        const pct = usage?.percent ?? null;

        // Bucket the CURRENT session context directly — self-contained, so
        // /tokens works even before the first LLM call of this session.
        const b = bucketMessages(sessionMessages(ctx));
        const sysTokens = charsToTokens(ctx.getSystemPrompt?.()?.length ?? 0);

        const sum = BUCKET_KEYS.reduce((s, k) => s + b[k], 0) + sysTokens;

        const lines: string[] = [];
        lines.push(
          `Context: ${total != null ? total.toLocaleString() : "n/a"} / ${win.toLocaleString()}` +
            (pct != null ? ` (${pct.toFixed(1)}%)` : ""),
        );
        lines.push("");
        lines.push(`System prompt: ${sysTokens.toLocaleString()}`);
        lines.push(`  contextFiles: ${contextFilesTokens.toLocaleString()}`);
        lines.push(`  skills: ${skillsTokens.toLocaleString()}`);
        lines.push("");
        lines.push("Layers (estimated, chars/4):");
        lines.push(`  user text: ${b.userText.toLocaleString()}`);
        lines.push(`  skill blocks: ${b.skillBlocks.toLocaleString()}`);
        lines.push(`  read results: ${b.readResults.toLocaleString()}`);
        lines.push(`  bash results: ${b.bashResults.toLocaleString()}`);
        lines.push(`  other tool results: ${b.otherToolResults.toLocaleString()}`);
        lines.push(`  thinking: ${b.thinking.toLocaleString()}`);
        lines.push(`  tool-call args: ${b.toolCallArgs.toLocaleString()}`);
        lines.push(`  assistant text: ${b.assistantText.toLocaleString()}`);
        lines.push("");
        lines.push(`Sum of layers: ${sum.toLocaleString()}`);
        if (total != null && total > 0) {
          const deltaPct = Math.round(((sum - total) / total) * 100);
          lines.push(`Delta vs context total: ${deltaPct}% (estimates are chars/4)`);
        }
        if (lastProviderUsage?.totalTokens) {
          const u = lastProviderUsage;
          lines.push(
            `Last provider usage: ${u.totalTokens.toLocaleString()} total (in ${u.input.toLocaleString()}, out ${u.output.toLocaleString()}, cacheRead ${u.cacheRead.toLocaleString()})`,
          );
        }

        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        ctx.ui.notify(
          `/tokens failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
