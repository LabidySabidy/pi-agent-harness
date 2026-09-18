/**
 * sources.ts — read-only data gathering from the harness.
 *
 * Reads telemetry.jsonl, skills directory, git logs.
 * Produces a deduped session set for the analysis layer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { repriceRecords } from "./pricing.js";

// ── Types (matching live telemetry shapes) ──────────────────────────

export interface TelemetryRecord {
  type: "boot" | "running" | "session_end";
  ts: string;
  "harness.session_id": string;
  "harness.project"?: string;
  "harness.device"?: string;
  "harness.estimator"?: string;
  "gen_ai.request.model"?: string;
  "gen_ai.usage.input_tokens"?: number;
  "gen_ai.usage.output_tokens"?: number;
  "gen_ai.usage.cost"?: number;
  "harness.usage.cache_read_tokens"?: number;
  "harness.usage.cache_write_tokens"?: number;
  "harness.lesson_hits"?: string[];
  "harness.skills"?: string[];
  "harness.gates"?: string;
  turn_index?: number;
  turn_count?: number;
  /** User prompts in the session; distinct from model-exchange turns. */
  user_turns?: number;
}

export interface SessionSummary {
  session_id: string;
  project: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Peak-rate cost as recorded by the harness (the catalog rate). Unchanged. */
  cost: number;
  /**
   * `cost` with the DeepSeek off-peak discount applied per record timestamp.
   * This is the spend estimate; `cost` is retained for comparison.
   */
  cost_offpeak_adjusted: number;
  /** Share of recorded cost that fell in off-peak hours (0-1). */
  offpeak_cost_share: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  skills: Set<string>;
  /** Model exchanges (turn_end events), monotonic per session. */
  turn_count: number;
  /** User prompts (message_start with role === "user"). */
  user_turns: number;
  started_at: string;
  ended_at: string;
}

export interface SourcesConfig {
  /** List of telemetry.jsonl paths to read. Default: harness only. */
  telemetryPaths: string[];
  /** Path to skills directory. */
  skillsDir: string;
  /** List of git repo roots to check for commit activity. */
  gitRoots: string[];
  /** Window in days (default 7). */
  windowDays: number;
  /** Retire-candidate threshold in weeks (default 4). */
  retireWeeks: number;
}

function discoverTelemetryPaths(): string[] {
  const paths = [
    path.join(process.env.HOME || "~", ".pi", ".agent", "telemetry.jsonl"),
  ];
  const devDir = "F:/Development";
  if (fs.existsSync(devDir)) {
    for (const entry of fs.readdirSync(devDir)) {
      const projectTelemetry = path.join(devDir, entry, ".agent", "telemetry.jsonl");
      if (fs.existsSync(projectTelemetry)) {
        paths.push(projectTelemetry);
      }
    }
  }
  return paths;
}

function discoverGitRoots(): string[] {
  const roots = [path.join(process.env.HOME || "~", ".pi")];
  const devDir = "F:/Development";
  if (fs.existsSync(devDir)) {
    for (const entry of fs.readdirSync(devDir)) {
      const repoPath = path.join(devDir, entry);
      if (fs.existsSync(path.join(repoPath, ".git"))) {
        roots.push(repoPath);
      }
    }
  }
  return roots;
}

const DEFAULT_CONFIG: SourcesConfig = {
  telemetryPaths: [], // filled by loadConfig
  skillsDir: path.join(process.env.HOME || "~", ".pi", "agent", "skills"),
  gitRoots: [], // filled by loadConfig
  windowDays: 7,
  retireWeeks: 4,
};

/**
 * Parse cost value from telemetry — handles primitive numbers
 * and gracefully ignores the old "0[object Object]" bug.
 */
function safeParseCost(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// ── Telemetry loading ──────────────────────────────────────────────

/**
 * Normalize a project name for display.
 * Windows paths like C:\Users\...\.pi → "harness"
 * Paths like f:/development/whisper-vtt → "whisper-vtt"
 */
export function normalizeProject(raw: string): string {
  if (/^[A-Z]:\\Users\\.*\.pi$/.test(raw)) return "harness";
  const match = raw.match(/[/\\]([^/\\]+?)(?:\.git)?$/i);
  if (match) return match[1].toLowerCase();
  return raw;
}

/**
 * Parse a single JSONL line, returning null for malformed / non-json.
 */
function parseLine(line: string): TelemetryRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as TelemetryRecord;
  } catch {
    return null; // torn last line or garbage — skip silently
  }
}

/**
 * Read all telemetry files, parse, filter to the window.
 */
export function loadTelemetry(config: SourcesConfig): TelemetryRecord[] {
  const since = Date.now() - config.windowDays * 24 * 60 * 60 * 1000;
  const records: TelemetryRecord[] = [];

  for (const tp of config.telemetryPaths) {
    if (!fs.existsSync(tp)) continue;
    const content = fs.readFileSync(tp, "utf-8");
    for (const line of content.split("\n")) {
      const rec = parseLine(line);
      if (!rec) continue;
      // Filter to window
      if (new Date(rec.ts).getTime() >= since) {
        records.push(rec);
      }
    }
  }

  return records;
}

/**
 * Deduplicate telemetry to one SessionSummary per session_id.
 *
 * Strategy per design doc §2:
 * - Prefer `session_end` record for token totals.
 * - Fall back to highest-turn_index `running` record if no session_end.
 * - `harness.skills` is a deduped set — merge all skills seen for the session.
 */
export function dedupeSessions(
  records: TelemetryRecord[],
  knownSkills?: Set<string>,
): SessionSummary[] {
  const bySession = new Map<string, {
    best: TelemetryRecord | null;
    skills: Set<string>;
    projects: Set<string>;
    models: Set<string>;
    started_at: string;
    ended_at: string;
    /** Per-record incremental cost, for time-of-day repricing. */
    runs: Array<{ ts: string; cumulative: number }>;
  }>();

  for (const rec of records) {
    const sid = rec["harness.session_id"];
    let entry = bySession.get(sid);
    if (!entry) {
      entry = {
        best: null,
        skills: new Set(),
        projects: new Set(),
        models: new Set(),
        started_at: rec.ts,
        ended_at: rec.ts,
        runs: [],
      };
      bySession.set(sid, entry);
    }

    // Track time range
    if (rec.ts < entry.started_at) entry.started_at = rec.ts;
    if (rec.ts > entry.ended_at) entry.ended_at = rec.ts;

    // Track project + model (normalize Windows paths)
    if (rec["harness.project"]) {
      const proj = normalizeProject(rec["harness.project"]!);
      entry.projects.add(proj);
    }
    if (rec["gen_ai.request.model"]) entry.models.add(rec["gen_ai.request.model"]);

    // Merge skills — filter against known set to exclude garbled records
    if (rec["harness.skills"]) {
      for (const s of rec["harness.skills"]) {
        if (!s || s.length === 0) continue;
        if (knownSkills && !knownSkills.has(s)) continue;
        entry.skills.add(s);
      }
    }

    // Collect running records for per-record time-of-day repricing.
    if (rec.type === "running") {
      entry.runs.push({ ts: rec.ts, cumulative: safeParseCost(rec["gen_ai.usage.cost"]) });
    }

    // session_end is authoritative
    if (rec.type === "session_end") {
      entry.best = rec;
    } else if (rec.type === "running" && entry.best?.type !== "session_end") {
      // Keep the running record with the highest turn_index
      const existingTurn = entry.best?.turn_index ?? -1;
      const thisTurn = rec.turn_index ?? -1;
      if (thisTurn > existingTurn) {
        entry.best = rec;
      }
    }
  }

  const results: SessionSummary[] = [];
  for (const [sid, entry] of bySession) {
    const best = entry.best;
    const recordedCost = safeParseCost(best?.["gen_ai.usage.cost"]);

    // Reprice by time of day. Telemetry's running records carry a cumulative cost,
    // so the increment between consecutive records is that turn's cost — and it is
    // the increment, not the session total, that has a single timestamp.
    const runs = [...entry.runs].sort((a, b) => a.ts.localeCompare(b.ts));
    let prev = 0;
    const increments: Array<{ ts: string; cost: number }> = [];
    for (const r of runs) {
      const delta = Math.max(0, r.cumulative - prev);
      prev = r.cumulative;
      if (delta > 0) increments.push({ ts: r.ts, cost: delta });
    }
    const repriced = repriceRecords(increments);

    // Fall back to the session total at peak when no running records exist (a
    // session that only ever wrote `session_end`), so a missing breakdown never
    // silently reports zero spend.
    const hasBreakdown = repriced.recorded > 0;
    const adjusted = hasBreakdown ? repriced.adjusted : recordedCost;
    const offpeakShare = hasBreakdown
      ? repriced.offPeakShare
      : 0;

    results.push({
      session_id: sid,
      project: [...entry.projects].join(", "),
      model: [...entry.models].join(", ") || "unknown",
      input_tokens: best?.["gen_ai.usage.input_tokens"] ?? 0,
      output_tokens: best?.["gen_ai.usage.output_tokens"] ?? 0,
      cost: recordedCost,
      cost_offpeak_adjusted: adjusted,
      offpeak_cost_share: offpeakShare,
      cache_read_tokens: best?.["harness.usage.cache_read_tokens"] ?? 0,
      cache_write_tokens: best?.["harness.usage.cache_write_tokens"] ?? 0,
      skills: entry.skills,
      turn_count: best?.["turn_count"] ?? best?.["turn_index"] ?? 0,
      user_turns: best?.["user_turns"] ?? 0,
      started_at: entry.started_at,
      ended_at: entry.ended_at,
    });
  }

  return results;
}

// ── Skills listing ──────────────────────────────────────────────────

/**
 * Return the set of skill names (no .md extension) present in the skills dir.
 */
export function listSkills(config: SourcesConfig): Set<string> {
  const skills = new Set<string>();
  if (!fs.existsSync(config.skillsDir)) return skills;
  for (const f of fs.readdirSync(config.skillsDir)) {
    if (f.startsWith("skill-") && f.endsWith(".md")) {
      // Extract name between "skill-" and ".md"
      skills.add(f.slice(6, -3));
    }
  }
  return skills;
}

// ── Git activity ────────────────────────────────────────────────────

/**
 * Return commits in the window, keyed by human-readable repo name.
 * Returns empty map for repos that don't exist or have no commits.
 */
export function countCommitsByRepo(config: SourcesConfig): Map<string, number> {
  const since = new Date(
    Date.now() - config.windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const byRepo = new Map<string, number>();
  for (const root of config.gitRoots) {
    try {
      const out = execFileSync(
        "git",
        ["-C", root, "log", "--oneline", `--since=${since}`],
        { encoding: "utf-8", timeout: 5000, windowsHide: true },
      ).trim();
      if (out.length > 0) {
        const name = path.basename(root) === ".pi" ? "harness" : path.basename(root);
        byRepo.set(name, out.split("\n").length);
      }
    } catch {
      // repo doesn't exist or has no commits in window — skip
    }
  }
  return byRepo;
}

/**
 * Total commits across all repos.
 */
export function countCommits(config: SourcesConfig): number {
  let total = 0;
  for (const count of countCommitsByRepo(config).values()) {
    total += count;
  }
  return total;
}

// ── History persistence ─────────────────────────────────────────────

export interface HistoryRow {
  week_start: string;
  week_end: string;
  session_count: number;
  commit_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  estimated_spend?: number; // deprecated — old price-table estimate
  spend?: number; // actual API cost (current)
  skills_used: Record<string, number>;
}

const HISTORY_PATH = path.join(
  process.env.HOME || "~",
  ".pi",
  "weekly-report",
  "history.json",
);

/**
 * Load existing history (returns [] if file missing or corrupt).
 */
export function loadHistory(): HistoryRow[] {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf-8");
    return JSON.parse(raw) as HistoryRow[];
  } catch {
    return [];
  }
}

/**
 * Append a row and write back.
 */
export function saveHistory(row: HistoryRow): void {
  const history = loadHistory();
  // One row per week — replace an existing row for the same week_start.
  const idx = history.findIndex((h) => h.week_start === row.week_start);
  if (idx >= 0) history[idx] = row;
  else history.push(row);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
}

// ── Config loading ──────────────────────────────────────────────────

/**
 * Merge user config overrides with defaults.
 */
export function loadConfig(overrides?: Partial<SourcesConfig>): SourcesConfig {
  const discovered: Partial<SourcesConfig> = {
    telemetryPaths: discoverTelemetryPaths(),
    gitRoots: discoverGitRoots(),
  };
  return { ...DEFAULT_CONFIG, ...discovered, ...overrides };
}
