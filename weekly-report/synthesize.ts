/**
 * synthesize.ts — deterministic weekly summary.
 *
 * Replaces the old LLM narrative. The summary is computed from WeeklyMetrics +
 * history with no model call, so it can never hallucinate numbers, fabricate
 * confidence ratings, or recommend mechanisms that don't exist. Every line is
 * a statement grounded in the data passed in.
 */

import type { WeeklyMetrics } from "./analyze.js";
import type { HistoryRow } from "./sources.js";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pctStr(n: number): string {
  return `${n >= 0 ? "▲" : "▼"}${Math.abs(n)}%`;
}

export function buildSummary(
  metrics: WeeklyMetrics,
  history: HistoryRow[],
): string {
  const lines: string[] = [];
  const top = metrics.project_breakdown[0];

  lines.push(
    `**${metrics.session_count} sessions** across ${metrics.projects.size} project(s), ${metrics.commit_count} commits.`,
  );

  if (top) {
    lines.push(
      `**${top.project}** led with ${top.sessions} sessions (${fmt(top.input_tokens)} in / ${fmt(top.output_tokens)} out, $${top.cost.toFixed(2)}).`,
    );
  }

  // Context reuse — a real efficiency signal (cache-read ÷ fresh input).
  if (metrics.context_reuse_ratio !== null && metrics.context_reuse_ratio >= 1) {
    const r = metrics.context_reuse_ratio;
    const level = r >= 30 ? "heavily cached (cheap)" : r >= 10 ? "moderately cached" : "lightly cached";
    lines.push(
      `Context reuse **${r.toFixed(0)}×** (${fmt(metrics.cache_read_tokens)} cache-read vs ${fmt(metrics.fresh_input_tokens)} fresh input) — ${level}.`,
    );
  }

  // Cost outlier — highest $/session among projects with ≥2 sessions.
  if (metrics.cost_outlier) {
    const o = metrics.cost_outlier;
    lines.push(
      `**${o.project}** is the cost outlier at **$${o.cost_per_session.toFixed(2)}/session** vs $${o.baseline.toFixed(2)} average.`,
    );
  }

  // Skills.
  lines.push(
    `**${metrics.skill_usage.length}/${metrics.total_skills}** skills active.`,
  );
  if (metrics.dormant_skills.length > 0) {
    lines.push(
      `Dormant 3+ weeks: ${metrics.dormant_skills.join(", ")} — review for integration or retirement.`,
    );
  }

  // Week-over-week.
  if (metrics.trends) {
    const t = metrics.trends;
    const spendPart = t.spend_comparable ? `spend ${pctStr(t.spend_pct)} · ` : "";
    lines.push(
      `Week-over-week: ${spendPart}sessions ${pctStr(t.sessions_pct)} · tokens ${pctStr(t.tokens_pct)} · commits ${pctStr(t.commits_pct)}.`,
    );
  }

  return lines.join("\n");
}
