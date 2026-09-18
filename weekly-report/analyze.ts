/**
 * analyze.ts — pure functions computing metrics from the deduped session set.
 *
 * No I/O, no side effects, no LLM, no price table. Spend is the catalog-rate cost
 * from telemetry (`gen_ai.usage.cost`) with the DeepSeek off-peak discount applied
 * per record timestamp (see pricing.ts) — it is an ESTIMATE, not API billing.
 */

import type { SessionSummary, HistoryRow } from "./sources.js";
import { normalizeProject } from "./sources.js";

// ── Metric types ────────────────────────────────────────────────────

export interface TokenVolume {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost: number; // actual API cost (USD)
}

export interface SkillUsage {
  skill: string;
  sessions: number; // sessions in window that loaded this skill
}

export interface ProjectBreakdown {
  project: string;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost: number; // actual API cost
  cost_per_session: number;
}

export interface CostOutlier {
  project: string;
  cost_per_session: number;
  baseline: number;
}

export interface LargestSession {
  session_id: string;
  project: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  /** Model exchanges (turn_end events) — NOT user prompts. */
  turn_count: number;
  /** User prompts. */
  user_turns: number;
}

export interface WeeklyTrends {
  spend_pct: number;
  sessions_pct: number;
  tokens_pct: number;
  commits_pct: number;
  /** True when the previous week recorded actual API cost (not an estimate). */
  spend_comparable: boolean;
}

export interface WeeklyMetrics {
  session_count: number;
  commit_count: number;
  projects: Set<string>;
  project_breakdown: ProjectBreakdown[];
  commits_by_repo: { repo: string; count: number }[];
  token_volumes: TokenVolume[];
  /** Off-peak-adjusted spend estimate (the headline figure). */
  actual_spend_total: number;
  /** Peak-rate spend as recorded, kept for comparison. */
  recorded_spend_total: number;
  /** Session ids whose model resolved to a retired/legacy catalog record. */
  legacy_model_sessions: string[];
  fresh_input_tokens: number;
  cache_read_tokens: number;
  context_reuse_ratio: number | null; // cache_read / fresh_input
  cost_outlier: CostOutlier | null;
  skill_usage: SkillUsage[];
  unused_skills: string[];
  dormant_skills: string[]; // unused this week AND for the last N history weeks
  total_skills: number;
  largest_sessions: LargestSession[];
  trends: WeeklyTrends | null;
  week_start: string;
  week_end: string;
}

// ── Legacy / retired catalog records (A5) ───────────────────────────

/** Model ids that no longer exist upstream but still appear in old telemetry. */
export const RETIRED_MODEL_IDS = new Set([
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
]);

/** Current peak (catalog) rates per million tokens, for consistency checks. */
const CURRENT_PEAK_RATES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "deepseek-v4-pro": { input: 1.32, output: 3.96, cacheRead: 0.044 },
};

/**
 * Explain why a session's recorded cost is not comparable to current pricing, or
 * null when it is. Flagged rather than silently repriced: a stale record means the
 * arithmetic is on the wrong schedule, and rewriting it would hide that.
 */
export function legacyModelWarning(s: SessionSummary): string | null {
  const models = s.model.split(",").map((m) => m.trim());
  for (const m of models) {
    if (RETIRED_MODEL_IDS.has(m)) {
      return `retired model id \`${m}\` (routed to V4.1 Flash; catalog rate is stale)`;
    }
  }
  // A Pro session priced off a stale schedule: compare the implied blended peak
  // rate against the current one. Only meaningful with enough tokens to divide by.
  for (const m of models) {
    const rates = CURRENT_PEAK_RATES[m];
    if (!rates || s.cost <= 0) continue;
    const denom =
      s.input_tokens * rates.input +
      s.output_tokens * rates.output +
      s.cache_read_tokens * rates.cacheRead;
    if (denom <= 0) continue;
    const expected = denom / 1e6;
    // Recorded cost is peak-rate; off-peak usage makes the true value lower, never
    // higher. A cost materially BELOW the peak expectation means a cheaper (stale)
    // schedule was in force for that session's model record.
    if (s.cost < expected * 0.8) {
      return `\`${m}\` priced below the current catalog rate — a stale model record supplied this session`;
    }
  }
  return null;
}

// ── Analysis functions ──────────────────────────────────────────────

export function computeTokenVolumes(sessions: SessionSummary[]): TokenVolume[] {
  const byModel = new Map<string, TokenVolume>();
  for (const s of sessions) {
    if (s.model === "unknown") continue;
    let vol = byModel.get(s.model);
    if (!vol) {
      vol = {
        model: s.model,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost: 0,
      };
      byModel.set(s.model, vol);
    }
    vol.input_tokens += s.input_tokens;
    vol.output_tokens += s.output_tokens;
    vol.cache_read_tokens += s.cache_read_tokens;
    vol.cache_write_tokens += s.cache_write_tokens;
    // Off-peak-adjusted, so the per-model table matches the headline total.
    vol.cost += s.cost_offpeak_adjusted;
  }
  return [...byModel.values()].sort(
    (a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens),
  );
}

export function computeSkillUsage(sessions: SessionSummary[]): SkillUsage[] {
  const usage = new Map<string, number>();
  for (const s of sessions) {
    for (const skill of s.skills) {
      usage.set(skill, (usage.get(skill) ?? 0) + 1);
    }
  }
  return [...usage.entries()]
    .map(([skill, sessions]) => ({ skill, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
}

function findUnusedSkills(
  allSkillNames: Set<string>,
  usage: SkillUsage[],
): string[] {
  const used = new Set(usage.filter((u) => u.sessions > 0).map((u) => u.skill));
  return [...allSkillNames].filter((s) => !used.has(s)).sort();
}

/**
 * Skills unused this week AND for the last `weeks` consecutive history rows.
 * A trend-based retirement signal rather than single-week noise.
 */
function findDormantSkills(
  allSkillNames: Set<string>,
  usage: SkillUsage[],
  history: HistoryRow[],
  weeks = 3,
): string[] {
  const usedNow = new Set(usage.filter((u) => u.sessions > 0).map((u) => u.skill));
  const recent = history.slice(-weeks);
  const dormant: string[] = [];
  for (const skill of allSkillNames) {
    if (usedNow.has(skill)) continue;
    const usedRecently = recent.some((row) => (row.skills_used?.[skill] ?? 0) > 0);
    if (!usedRecently) dormant.push(skill);
  }
  return dormant.sort();
}

function computeCostOutlier(projects: ProjectBreakdown[]): CostOutlier | null {
  const eligible = projects.filter((p) => p.sessions >= 2 && p.cost > 0);
  if (eligible.length === 0) return null;
  const totalCost = projects.reduce((s, p) => s + p.cost, 0);
  const totalSessions = projects.reduce((s, p) => s + p.sessions, 0);
  const baseline = totalSessions > 0 ? totalCost / totalSessions : 0;
  const worst = eligible.reduce((a, b) =>
    a.cost_per_session >= b.cost_per_session ? a : b,
  );
  if (baseline > 0 && worst.cost_per_session >= baseline * 2) {
    return {
      project: worst.project,
      cost_per_session: worst.cost_per_session,
      baseline,
    };
  }
  return null;
}

export function computeMetrics(
  sessions: SessionSummary[],
  commitsByRepo: Map<string, number>,
  allSkillNames: Set<string>,
  history: HistoryRow[] = [],
): WeeklyMetrics {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousWeek = history.length > 0 ? history[history.length - 1] : null;

  const byProject = new Map<
    string,
    {
      sessions: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
      cost: number;
    }
  >();
  for (const s of sessions) {
    const proj = normalizeProject(s.project) || "unknown";
    let e = byProject.get(proj);
    if (!e) {
      e = {
        sessions: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost: 0,
      };
      byProject.set(proj, e);
    }
    e.sessions++;
    e.input_tokens += s.input_tokens;
    e.output_tokens += s.output_tokens;
    e.cache_read_tokens += s.cache_read_tokens;
    e.cache_write_tokens += s.cache_write_tokens;
    e.cost += s.cost;
  }

  const project_breakdown: ProjectBreakdown[] = [...byProject.entries()]
    .map(([project, e]) => ({
      project,
      ...e,
      cost_per_session: e.sessions > 0 ? e.cost / e.sessions : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const token_volumes = computeTokenVolumes(sessions);
  const skill_usage = computeSkillUsage(sessions);
  const unused_skills = findUnusedSkills(allSkillNames, skill_usage);
  const dormant_skills = findDormantSkills(allSkillNames, skill_usage, history);

  const actual_spend_total = sessions.reduce((s, x) => s + x.cost_offpeak_adjusted, 0);
  const recorded_spend_total = sessions.reduce((s, x) => s + x.cost, 0);
  const legacy_model_sessions = sessions
    .map((s) => ({ id: s.session_id, model: s.model, reason: legacyModelWarning(s) }))
    .filter((e): e is { id: string; model: string; reason: string } => e.reason !== null)
    .map((e) => `${e.model}: ${e.reason}`);
  const fresh_input_tokens = token_volumes.reduce((s, v) => s + v.input_tokens, 0);
  const cache_read_tokens = token_volumes.reduce((s, v) => s + v.cache_read_tokens, 0);
  const context_reuse_ratio =
    fresh_input_tokens > 0 ? cache_read_tokens / fresh_input_tokens : null;

  const cost_outlier = computeCostOutlier(project_breakdown);

  const totalCommits = [...commitsByRepo.values()].reduce((s, c) => s + c, 0);

  let trends: WeeklyTrends | null = null;
  if (previousWeek) {
    const thisTokens = token_volumes.reduce(
      (s, v) => s + v.input_tokens + v.output_tokens,
      0,
    );
    const prevTokens =
      previousWeek.total_input_tokens + previousWeek.total_output_tokens;
    const prevSpend = previousWeek.spend ?? previousWeek.estimated_spend ?? 0;
    trends = {
      spend_pct:
        prevSpend > 0
          ? pct((actual_spend_total - prevSpend) / prevSpend)
          : 0,
      sessions_pct:
        previousWeek.session_count > 0
          ? pct((sessions.length - previousWeek.session_count) / previousWeek.session_count)
          : 0,
      tokens_pct:
        prevTokens > 0 ? pct((thisTokens - prevTokens) / prevTokens) : 0,
      commits_pct:
        previousWeek.commit_count > 0
          ? pct((totalCommits - previousWeek.commit_count) / previousWeek.commit_count)
          : 0,
      spend_comparable: previousWeek.spend !== undefined,
    };
  }

  const largest_sessions: LargestSession[] = sessions
    .map((s) => ({
      session_id: s.session_id,
      project: normalizeProject(s.project) || "unknown",
      input_tokens: s.input_tokens,
      output_tokens: s.output_tokens,
      cost: s.cost,
      turn_count: s.turn_count,
      user_turns: s.user_turns,
    }))
    .sort((a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens))
    .slice(0, 3);

  const projects = new Set<string>();
  for (const s of sessions) {
    const p = normalizeProject(s.project);
    if (p) projects.add(p);
  }

  return {
    session_count: sessions.length,
    commit_count: totalCommits,
    projects,
    project_breakdown,
    commits_by_repo: [...commitsByRepo.entries()]
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => b.count - a.count),
    token_volumes,
    actual_spend_total,
    recorded_spend_total,
    legacy_model_sessions,
    fresh_input_tokens,
    cache_read_tokens,
    context_reuse_ratio,
    cost_outlier,
    skill_usage,
    unused_skills,
    dormant_skills,
    total_skills: allSkillNames.size,
    largest_sessions,
    trends,
    week_start: weekAgo.toISOString().slice(0, 10),
    week_end: now.toISOString().slice(0, 10),
  };
}

function pct(n: number): number {
  return Math.round(n * 100);
}
