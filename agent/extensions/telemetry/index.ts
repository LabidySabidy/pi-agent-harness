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
 *   gen_ai.request.model               harness.boot.payload
 *   harness.lesson_hits                harness.skills
 *   harness.gates                      harness.device
 *   harness.git_sha                    harness.estimator
 *   harness.session_id                 ts
 *   harness.project                    harness.session_file
 */

import type { ExtensionAPI, AgentEndEvent } from "@earendil-works/pi-coding-agent";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import * as os from "node:os";

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

// Files loaded per AGENTS.md session-start protocol
const PROTOCOL_FILES: Array<{ name: string; path: string[] }> = [
  { name: "STANDARDS.md (global)", path: ["agent", "STANDARDS.md"] },
  { name: "LESSONS.md (global)", path: ["agent", "LESSONS.md"] },
  { name: "AGENTS.md (project)", path: ["AGENTS.md"] },
  { name: "STANDARDS.md (project)", path: ["STANDARDS.md"] },
  { name: "VISION.md", path: ["VISION.md"] },
  { name: "PROGRESS.md", path: ["PROGRESS.md"] },
  { name: "LESSONS.md (project)", path: ["LESSONS.md"] },
];

// Lesson citation regex: matches GL-001, L-042, etc.
const LESSON_CITE_RE = /\b(GL|L)-(\d{3})\b/g;

// Skill invocation regex: matches /skill:name patterns
const SKILL_RE = /\/skill:(\S+)/g;

// Gate detection patterns
const GATE_PASS_RE = /\b(?:gates?\s*(?:pass(?:ing|ed)?|green|clean)|all\s+(?:checks?\s+)?pass)\b/i;
const GATE_FAIL_RE = /\b(?:gates?\s*(?:fail|red|broken)|(?:lint|test|build|type)\s+(?:fail|error))\b/i;

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
  "harness.usage.cache_read_tokens": number;
  "harness.usage.cache_write_tokens": number;
  "harness.lesson_hits": string[];
  "harness.skills": string[];
  "harness.gates": string; // "pass" | "fail" | "unknown"
  turn_index: number;
}

interface SessionEndRecord {
  type: "session_end";
  ts: string;
  "harness.session_id": string;
  "harness.project": string;
  "gen_ai.usage.input_tokens": number;
  "gen_ai.usage.output_tokens": number;
  "harness.usage.cache_read_tokens": number;
  "harness.usage.cache_write_tokens": number;
  "harness.lesson_hits": string[];
  "harness.skills": string[];
  "harness.gates": string;
  turn_count: number;
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
    lessonHits: string[];
    skills: string[];
    gates: string;
    models: string[];
    turnIndex: number;
  };
}

interface LessonStatsEntry {
  hits: number;
  last_used: string | null;
  device_last_hit: string | null;
  decay: number;
  confidence: number;
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
      const filePath = join(cwd, ...file.path);
      const content = await fs.readFile(filePath, "utf8");
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
      "harness.usage.cache_read_tokens": record["harness.usage.cache_read_tokens"] ?? 0,
      "harness.usage.cache_write_tokens": record["harness.usage.cache_write_tokens"] ?? 0,
      "harness.lesson_hits": record["harness.lesson_hits"] ?? [],
      "harness.skills": record["harness.skills"] ?? [],
      "harness.gates": record["harness.gates"] ?? "unknown",
      turn_count: record.turn_index ?? 0,
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
    lessonHits: [],
    skills: [],
    gates: "unknown",
    models: [],
    turnIndex: 0,
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
    ids.add(`${match[1]}-${match[2]}`);
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

function detectGates(text: string): string {
  if (GATE_PASS_RE.test(text)) return "pass";
  if (GATE_FAIL_RE.test(text)) return "fail";
  return "unknown";
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
// Lesson stats maintenance
// ─────────────────────────────────────────────────────────────────────────

async function updateLessonStats(
  lessonIds: string[],
  projectDir: string,
): Promise<void> {
  if (lessonIds.length === 0) return;

  const now = isoNow();
  const device = deviceName ?? os.hostname();

  for (const id of lessonIds) {
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
            decay: 1.0,
            confidence: 0.5,
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

      // Journal recovery: finalize previous session if needed
      if (state?.previousSessionId && state.previousSessionProject) {
        await recoverJournal(
          telemetryPath,
          statePath,
          state.previousSessionId,
          state.previousSessionProject,
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

  // ── agent_end ────────────────────────────────────────────────────────
  pi.on("agent_end", async (event: AgentEndEvent, ctx: any) => {
    try {
      if (!state || !state.currentSessionId || !projectDir) return;

      const { telemetryPath, statePath, shouldWrite } =
        await getTelemetryTarget(projectDir);
      if (!shouldWrite) return;

      // Reload state (might have been modified by another hook)
      const currentState = await readState(statePath);
      if (!currentState || currentState.currentSessionId !== sessionId) {
        // Session was replaced — reload state
        state = currentState;
        if (!state || !state.currentSessionId) return;
      }

      const messages = event?.messages ?? [];

      // Extract text from new assistant messages for pattern scanning
      let newText = "";
      let cumulativeInput = state.cumulative.inputTokens;
      let cumulativeOutput = state.cumulative.outputTokens;
      let cumulativeCacheRead = state.cumulative.cacheReadTokens;
      let cumulativeCacheWrite = state.cumulative.cacheWriteTokens;
      const lessonIds = new Set(state.cumulative.lessonHits);
      const skills = new Set(state.cumulative.skills);
      const models = new Set(state.cumulative.models);
      let gateStatus = state.cumulative.gates;

      for (const msg of messages) {
        // Extract usage from assistant messages
        const role = (msg as any).role;
        if (role === "assistant") {
          const usage = (msg as any).usage;
          if (usage) {
            cumulativeInput += usage.input ?? 0;
            cumulativeOutput += usage.output ?? 0;
            cumulativeCacheRead += usage.cacheRead ?? 0;
            cumulativeCacheWrite += usage.cacheWrite ?? 0;
          }
          const model = (msg as any).model;
          if (model) models.add(model);

          const text = extractMessageText(msg as any);
          newText += text + "\n";
        }
      }

      // Scan new text for patterns
      for (const id of extractLessonCitations(newText)) {
        lessonIds.add(id);
      }
      for (const skill of extractSkills(newText)) {
        skills.add(skill);
      }
      const detectedGate = detectGates(newText);
      if (detectedGate !== "unknown") {
        gateStatus = detectedGate;
      }

      const turnIndex = state.cumulative.turnIndex + 1;

      const model = models.size > 0 ? [...models].slice(-1)[0] : "unknown";

      const record: RunningRecord = {
        type: "running",
        ts: isoNow(),
        "harness.session_id": state.currentSessionId,
        "harness.project": state.projectKey,
        "harness.device": deviceName ?? os.hostname(),
        "harness.estimator": ESTIMATOR,
        "gen_ai.request.model": model,
        "gen_ai.usage.input_tokens": cumulativeInput,
        "gen_ai.usage.output_tokens": cumulativeOutput,
        "harness.usage.cache_read_tokens": cumulativeCacheRead,
        "harness.usage.cache_write_tokens": cumulativeCacheWrite,
        "harness.lesson_hits": [...lessonIds].sort(),
        "harness.skills": [...skills].sort(),
        "harness.gates": gateStatus,
        turn_index: turnIndex,
      };

      // Update state
      state.cumulative = {
        inputTokens: cumulativeInput,
        outputTokens: cumulativeOutput,
        cacheReadTokens: cumulativeCacheRead,
        cacheWriteTokens: cumulativeCacheWrite,
        lessonHits: [...lessonIds],
        skills: [...skills],
        gates: gateStatus,
        models: [...models],
        turnIndex,
      };
      await writeState(statePath, state);

      // Append running record
      await appendLine(telemetryPath, JSON.stringify(record));

      // Update lesson stats
      await updateLessonStats([...lessonIds], projectDir).catch(() => {});
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
        "harness.usage.cache_read_tokens": state.cumulative.cacheReadTokens,
        "harness.usage.cache_write_tokens": state.cumulative.cacheWriteTokens,
        "harness.lesson_hits": state.cumulative.lessonHits,
        "harness.skills": state.cumulative.skills,
        "harness.gates": state.cumulative.gates,
        turn_count: state.cumulative.turnIndex,
      };

      await appendLine(telemetryPath, JSON.stringify(endRecord));
    } catch (err) {
      if (projectDir) {
        await logError(
          projectDir,
          `session_shutdown: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
      }
    }
  });
}
