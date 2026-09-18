/**
 * render.ts — metrics → Discord embed + local markdown report.
 *
 * Pure rendering. No I/O (file writing is in report.ts). Single spend source:
 * actual API cost from telemetry.
 */

import type { WeeklyMetrics, SkillUsage } from "./analyze.js";
import type { HistoryRow } from "./sources.js";

// ── Discord embed limits ────────────────────────────────────────────

const DISCORD_LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  total: 6000,
  maxEmbeds: 10,
} as const;

// ── Discord embed ───────────────────────────────────────────────────

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: DiscordEmbedField[];
  footer: { text: string };
  timestamp: string;
}

export function buildEmbed(
  metrics: WeeklyMetrics,
  history: HistoryRow[],
  displayName?: string,
  summary?: string,
): DiscordEmbed {
  const fields: DiscordEmbedField[] = [];

  // Activity — per-project breakdown (actual API cost)
  const breakdownLines: string[] = [];
  for (const pb of metrics.project_breakdown) {
    breakdownLines.push(
      `**${pb.project}** — ${pb.sessions} session${pb.sessions === 1 ? "" : "s"} $${pb.cost.toFixed(2)}`,
    );
  }
  fields.push({
    name: "📊 Activity",
    value: truncate(
      [...breakdownLines, `**${metrics.commit_count}** commits`].join("\n"),
      DISCORD_LIMITS.fieldValue,
    ),
    inline: false,
  });

  // Commits by repo (if multiple repos have commits)
  if (metrics.commits_by_repo.length > 1) {
    const commitLines = metrics.commits_by_repo
      .filter((r) => r.count > 0)
      .map((r) => `• ${r.repo}: ${r.count}`);
    fields.push({
      name: "📝 Commits by Repo",
      value: truncate(commitLines.join("\n"), DISCORD_LIMITS.fieldValue),
      inline: false,
    });
  }

  // 4-week trend table
  const trendTable = buildTrendTable(metrics, history);
  if (trendTable.length > 1) {
    fields.push({
      name: "📈 Trend (4 weeks)",
      value: truncate(trendTable.join("\n"), DISCORD_LIMITS.fieldValue),
      inline: false,
    });
  }

  // Largest sessions
  if (metrics.largest_sessions.length > 0) {
    const lines = metrics.largest_sessions.map((ls) => {
      const totalTokens = ls.input_tokens + ls.output_tokens;
      const costStr = ls.cost > 0 ? ` $${ls.cost.toFixed(2)}` : "";
      return `**${ls.project}** — ${formatNum(totalTokens)} tokens, ${ls.turn_count} model exchanges / ${ls.user_turns} prompts${costStr}`;
    });
    fields.push({
      name: "🔥 Largest Sessions",
      value: truncate(lines.join("\n"), DISCORD_LIMITS.fieldValue),
      inline: false,
    });
  }

  // Tokens
  if (metrics.token_volumes.length > 0) {
    const tokenLines: string[] = [];
    for (const v of metrics.token_volumes) {
      tokenLines.push(
        `**${v.model}** — in: ${formatNum(v.input_tokens)} | out: ${formatNum(v.output_tokens)} | cache-read: ${formatNum(v.cache_read_tokens)}`,
      );
    }
    fields.push({
      name: "🔢 Token Volume",
      value: truncate(tokenLines.join("\n"), DISCORD_LIMITS.fieldValue),
      inline: false,
    });
  }

  // Context reuse
  if (metrics.context_reuse_ratio !== null && metrics.context_reuse_ratio >= 1) {
    fields.push({
      name: "⚡ Context Reuse",
      value: `${metrics.context_reuse_ratio.toFixed(0)}× (${formatNum(metrics.cache_read_tokens)} cache-read ÷ ${formatNum(metrics.fresh_input_tokens)} fresh input)`,
      inline: false,
    });
  }

  // Spend estimate (catalog rate, off-peak adjusted)
  if (metrics.token_volumes.length > 0) {
    const spendLines: string[] = [];
    for (const v of metrics.token_volumes) {
      spendLines.push(`**${v.model}** — $${v.cost.toFixed(2)}`);
    }
    spendLines.push(`\n**Total: $${metrics.actual_spend_total.toFixed(2)}**`);
    if (metrics.recorded_spend_total > metrics.actual_spend_total * 1.02) {
      spendLines.push(
        `_(peak-rate catalog total was $${metrics.recorded_spend_total.toFixed(2)}; off-peak discount applied)_`,
      );
    }
    fields.push({
      name: "💰 Estimated Spend (tokens × catalog rate, off-peak adjusted)",
      value: truncate(spendLines.join("\n"), DISCORD_LIMITS.fieldValue),
      inline: false,
    });
  }

  // Cost outlier
  if (metrics.cost_outlier) {
    const o = metrics.cost_outlier;
    fields.push({
      name: "🎯 Cost Outlier",
      value: `**${o.project}** — $${o.cost_per_session.toFixed(2)}/session vs $${o.baseline.toFixed(2)} average`,
      inline: false,
    });
  }

  // Top skills
  if (metrics.skill_usage.length > 0) {
    const topSkills = metrics.skill_usage.slice(0, 8);
    const lines = topSkills.map(
      (s) => `**${s.skill}** — ${s.sessions} session${s.sessions === 1 ? "" : "s"}`,
    );
    fields.push({
      name: "🛠️ Top Skills (loaded)",
      value: truncate(lines.join("\n"), DISCORD_LIMITS.fieldValue),
      inline: false,
    });
  }

  // Skill health — active / dormant / unused
  fields.push({
    name: "🔧 Skill Health",
    value: truncate(
      `${metrics.skill_usage.length}/${metrics.total_skills} active. ` +
        (metrics.dormant_skills.length > 0
          ? `Dormant 3+ wks: ${metrics.dormant_skills.join(", ")}. `
          : "") +
        (metrics.unused_skills.length > 0
          ? `Unused this week: ${metrics.unused_skills.join(", ")}`
          : ""),
      DISCORD_LIMITS.fieldValue,
    ),
    inline: false,
  });

  const title = displayName
    ? `🌱 Harness Weekly — ${displayName} — ${metrics.week_start} → ${metrics.week_end}`
    : `🌱 Harness Weekly — ${metrics.week_start} → ${metrics.week_end}`;

  return {
    title,
    description: summary ? truncate(summary, DISCORD_LIMITS.description) : "",
    color: 0x5865f2,
    fields,
    footer: { text: displayName ? `Advisory only · ${displayName}` : "Advisory only — read-only report from harness telemetry" },
    timestamp: new Date().toISOString(),
  };
}

// ── Markdown report ─────────────────────────────────────────────────

export function buildMarkdown(
  metrics: WeeklyMetrics,
  history: HistoryRow[],
  displayName?: string,
  summary?: string,
): string {
  const lines: string[] = [];

  lines.push(
    displayName
      ? `# 🌱 Harness Weekly — ${displayName} — ${metrics.week_start} → ${metrics.week_end}`
      : `# 🌱 Harness Weekly — ${metrics.week_start} → ${metrics.week_end}`,
  );
  lines.push("");
  lines.push(`*Generated: ${new Date().toISOString()}*`);
  lines.push("");

  if (summary) {
    lines.push("## Summary");
    lines.push("");
    lines.push(summary);
    lines.push("");
  }

  // Activity
  lines.push("## 📊 Activity");
  lines.push("");
  lines.push("| Project | Sessions | Tokens In | Tokens Out | Cost |");
  lines.push("|---------|----------|-----------|------------|------|");
  for (const pb of metrics.project_breakdown) {
    lines.push(
      `| ${pb.project} | ${pb.sessions} | ${formatNum(pb.input_tokens)} | ${formatNum(pb.output_tokens)} | $${pb.cost.toFixed(2)} |`,
    );
  }
  lines.push("");
  lines.push(`- **${metrics.session_count}** total sessions`);
  lines.push(`- **${metrics.commit_count}** total commits`);
  if (metrics.commits_by_repo.length > 0) {
    for (const repo of metrics.commits_by_repo) {
      lines.push(`  - ${repo.repo}: ${repo.count}`);
    }
  }
  lines.push("");

  // Trend table
  const trendTable = buildTrendTable(metrics, history);
  if (trendTable.length > 1) {
    lines.push("## 📈 Trend (4 weeks)");
    lines.push("");
    lines.push("| Week ending | Sessions | Tokens | Spend |");
    lines.push("|-------------|----------|--------|-------|");
    for (const row of trendTable) {
      lines.push(`| ${row} |`);
    }
    lines.push("");
  }

  // Largest sessions
  if (metrics.largest_sessions.length > 0) {
    lines.push("## 🔥 Largest Sessions");
    lines.push("");
    lines.push("| Project | Tokens | Model exchanges | Prompts | Cost |");
    lines.push("|---------|--------|-----------------|---------|------|");
    for (const ls of metrics.largest_sessions) {
      const totalTokens = ls.input_tokens + ls.output_tokens;
      lines.push(
        `| ${ls.project} | ${formatNum(totalTokens)} | ${ls.turn_count} | ${ls.user_turns} | $${ls.cost.toFixed(2)} |`,
      );
    }
    lines.push("");
  }

  // Token volume
  if (metrics.token_volumes.length > 0) {
    lines.push("## 🔢 Token Volume");
    lines.push("");
    lines.push("| Model | Input | Output | Cache read | Cost |");
    lines.push("|-------|-------|--------|------------|------|");
    for (const v of metrics.token_volumes) {
      lines.push(
        `| ${v.model} | ${formatNum(v.input_tokens)} | ${formatNum(v.output_tokens)} | ${formatNum(v.cache_read_tokens)} | $${v.cost.toFixed(2)} |`,
      );
    }
    lines.push("");
  }

  // Context reuse
  if (metrics.context_reuse_ratio !== null && metrics.context_reuse_ratio >= 1) {
    lines.push("## ⚡ Context Reuse");
    lines.push("");
    lines.push(
      `${metrics.context_reuse_ratio.toFixed(0)}× — ${formatNum(metrics.cache_read_tokens)} cache-read ÷ ${formatNum(metrics.fresh_input_tokens)} fresh input.`,
    );
    lines.push("");
  }

  // Spend estimate
  if (metrics.token_volumes.length > 0) {
    lines.push("## 💰 Estimated Spend (tokens × catalog rate, off-peak adjusted)");
    lines.push("");
    lines.push("| Model | Estimated cost |");
    lines.push("|-------|------|");
    for (const v of metrics.token_volumes) {
      lines.push(`| ${v.model} | $${v.cost.toFixed(2)} |`);
    }
    lines.push("");
    lines.push(`**Estimated total: $${metrics.actual_spend_total.toFixed(2)}**`);
    if (metrics.recorded_spend_total > metrics.actual_spend_total * 1.02) {
      lines.push("");
      lines.push(
        `_Peak-rate catalog total was $${metrics.recorded_spend_total.toFixed(2)}; the off-peak discount (half rate, all hours outside Mon-Fri 01:00-04:00 and 06:00-10:00 UTC) accounts for the difference._`,
      );
    }
    lines.push("");
  }

  // Legacy / retired model records (A5) — flag, never silently reprice.
  if (metrics.legacy_model_sessions.length > 0) {
    lines.push("### ⚠️ Sessions priced on retired or stale model records");
    lines.push("");
    lines.push(
      "These sessions resolved to a model record that is no longer correct upstream. Their cost is shown as recorded and is **not** comparable to current pricing:",
    );
    lines.push("");
    const seen = new Set<string>();
    for (const l of metrics.legacy_model_sessions) {
      if (seen.has(l)) continue;
      seen.add(l);
      lines.push(`- ${l}`);
    }
    lines.push("");
  }

  // Cost outlier
  if (metrics.cost_outlier) {
    const o = metrics.cost_outlier;
    lines.push("## 🎯 Cost Outlier");
    lines.push("");
    lines.push(
      `**${o.project}** — $${o.cost_per_session.toFixed(2)}/session vs $${o.baseline.toFixed(2)} average (≥2 sessions).`,
    );
    lines.push("");
  }

  // Skill usage
  if (metrics.skill_usage.length > 0) {
    lines.push("## 🛠️ Skill Usage (sessions that loaded each skill)");
    lines.push("");
    lines.push("| Skill | Sessions |");
    lines.push("|-------|----------|");
    for (const s of metrics.skill_usage) {
      lines.push(`| ${s.skill} | ${s.sessions} |`);
    }
    lines.push("");
  }

  // Skill health
  lines.push("## 🔧 Skill Health");
  lines.push("");
  lines.push(`${metrics.skill_usage.length} of ${metrics.total_skills} skills active this week.`);
  if (metrics.dormant_skills.length > 0) {
    lines.push("");
    lines.push("Dormant 3+ weeks (review for integration or retirement):");
    for (const s of metrics.dormant_skills) {
      lines.push(`- \`${s}\``);
    }
  }
  if (metrics.unused_skills.length > 0) {
    lines.push("");
    lines.push("Unused this week:");
    for (const s of metrics.unused_skills) {
      lines.push(`- \`${s}\``);
    }
  }
  lines.push("");

  // Footer
  lines.push("---");
  lines.push(
    "*Report generated by [weekly-report](~/.pi/weekly-report/). Read-only — never modifies harness data. Spend is an estimate: tokens × the resolved model's catalog rate, with the DeepSeek off-peak discount applied per record. The provider's own usage page is the authority.*",
  );

  return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Build a 4-week trend table (rows formatted as `week | sessions | tokens | spend`).
 */
function buildTrendTable(
  metrics: WeeklyMetrics,
  history: HistoryRow[],
): string[] {
  const rows: Array<{
    week: string;
    sessions: number;
    tokens: number;
    spend: number;
    isEstimate: boolean;
  }> = [];

  // Current week
  rows.push({
    week: metrics.week_end,
    sessions: metrics.session_count,
    tokens: metrics.token_volumes.reduce(
      (s, v) => s + v.input_tokens + v.output_tokens,
      0,
    ),
    spend: metrics.actual_spend_total,
    isEstimate: false,
  });

  // Previous weeks (oldest → newest); skip any row that is the current week.
  for (const h of history.slice(-3)) {
    const week = h.week_end ?? h.week_start;
    if (week === metrics.week_end) continue;
    const isEstimate = h.spend === undefined;
    rows.push({
      week,
      sessions: h.session_count,
      tokens: h.total_input_tokens + h.total_output_tokens,
      spend: h.spend ?? h.estimated_spend ?? 0,
      isEstimate,
    });
  }

  // Sort by week ascending, keep at most 4
  rows.sort((a, b) => a.week.localeCompare(b.week));
  return rows.slice(-4).map(
    (r) =>
      `${r.week} | ${r.sessions} | ${formatNum(r.tokens)} | ${r.isEstimate ? "≈$" : "$"}${r.spend.toFixed(2)}`,
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
