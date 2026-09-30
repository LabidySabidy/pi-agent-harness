/**
 * report.ts — entry point: gather → analyze → render → deliver.
 *
 * Usage:
 *   npx tsx report.ts          # full run: report + Discord POST
 *   npx tsx report.ts --dry    # write report, print embed JSON, skip POST
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, loadTelemetry, dedupeSessions, listSkills, countCommitsByRepo, loadHistory, saveHistory, type HistoryRow } from "./sources.js";
import { computeMetrics } from "./analyze.js";
import { buildEmbed, buildMarkdown } from "./render.js";
import { buildSummary } from "./synthesize.js";

// ── Secrets ─────────────────────────────────────────────────────────

interface Secrets {
  discordWebhookUrl?: string;
  displayName?: string;
}

function loadSecrets(): Secrets {
  const secretsPath = path.join(__dirname, ".secrets.json");
  try {
    const raw = fs.readFileSync(secretsPath, "utf-8");
    return JSON.parse(raw) as Secrets;
  } catch {
    return {};
  }
}

function loadWebhookUrl(): string | null {
  if (process.env.DISCORD_WEBHOOK_URL) {
    return process.env.DISCORD_WEBHOOK_URL;
  }
  return loadSecrets().discordWebhookUrl ?? null;
}

function loadDisplayName(): string {
  // 1. Explicit config in .secrets.json
  const configured = loadSecrets().displayName;
  if (configured) return configured;

  // 2. Env var override
  if (process.env.DISPLAY_NAME) return process.env.DISPLAY_NAME;

  // 3. OS hostname fallback
  return require("node:os").hostname();
}

// ── Discord delivery ────────────────────────────────────────────────

async function postToDiscord(webhookUrl: string, embed: object): Promise<boolean> {
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });

    if (resp.status === 429) {
      const retryAfter = resp.headers.get("retry_after");
      const waitSec = retryAfter ? parseInt(retryAfter, 10) : 5;
      console.error(`[weekly-report] HTTP 429 — retrying after ${waitSec}s`);
      await sleep(waitSec * 1000);
      const retryResp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!retryResp.ok) {
        console.error(
          `[weekly-report] Retry failed: HTTP ${retryResp.status} ${retryResp.statusText}`,
        );
        return false;
      }
      return true;
    }

    if (!resp.ok) {
      console.error(
        `[weekly-report] Discord POST failed: HTTP ${resp.status} ${resp.statusText}`,
      );
      const body = await resp.text().catch(() => "");
      if (body) console.error(`[weekly-report] Response: ${body.slice(0, 500)}`);
      return false;
    }

    console.log("[weekly-report] Discord POST successful");
    return true;
  } catch (err) {
    console.error(`[weekly-report] Discord POST error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * The logon guard: at most one report per 6 days. Shared by the normal and quiet paths so the two
 * cannot drift — the quiet path used to bypass the guard entirely, which is why a run of quiet days
 * posted nothing and recorded nothing.
 *
 * Returns the week_end it is skipping for, or null when the run should proceed.
 */
function recentlyReportedWeekEnd(
  previousWeek: HistoryRow | null,
  forceRun: boolean,
): string | null {
  if (forceRun || !previousWeek?.week_end) return null;
  const lastPosted = Date.parse(previousWeek.week_end);
  if (Number.isNaN(lastPosted)) return null;
  if (Date.now() - lastPosted >= SIX_DAYS_MS) return null;
  return previousWeek.week_end;
}

type DeliveryResult = { ok: true } | { ok: false; reason: "no-webhook" | "post-failed" };

/**
 * Load the webhook, post, and report the outcome. Shared so both paths print the same line and fail
 * the same way. The no-webhook message lives here; each caller adds its own context line, which is
 * how the normal path's two-line output is preserved exactly.
 */
async function deliverEmbed(embed: object): Promise<DeliveryResult> {
  const webhookUrl = loadWebhookUrl();
  if (!webhookUrl) {
    console.error(
      "[weekly-report] No Discord webhook URL configured. Set DISCORD_WEBHOOK_URL env var or create .secrets.json.",
    );
    return { ok: false, reason: "no-webhook" };
  }
  const success = await postToDiscord(webhookUrl, embed);
  return success ? { ok: true } : { ok: false, reason: "post-failed" };
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry");
  const forceRun = process.argv.includes("--force");
  const config = loadConfig();

  console.log(
    `[weekly-report] ${dryRun ? "DRY RUN" : "FULL RUN"} — window: ${config.windowDays}d`,
  );

  // 1. Gather
  const records = loadTelemetry(config);
  if (records.length === 0) {
    // A quiet week is not a broken pipeline, and until now the two were indistinguishable: this
    // path logged one line and returned ABOVE the logon guard, so nothing was posted and nothing
    // was recorded. Eleven consecutive quiet days looked exactly like a task that had stopped firing.
    //
    // It now behaves like a normal run — same guard, same history row, same exit code 0 — with the
    // Discord post and a distinct log line as the signal.
    const now = new Date();
    const weekAgo = new Date(now.getTime() - config.windowDays * 24 * 60 * 60 * 1000);
    const quietWeekStart = weekAgo.toISOString().slice(0, 10);
    const quietWeekEnd = now.toISOString().slice(0, 10);

    const quietHistory = loadHistory();
    const quietPrevious =
      quietHistory.length > 0 ? quietHistory[quietHistory.length - 1] : null;

    const alreadyReported = recentlyReportedWeekEnd(quietPrevious, forceRun);
    if (alreadyReported) {
      console.log(`[weekly-report] Already reported ${alreadyReported}. Skipping.`);
      return;
    }

    console.log("[weekly-report] NO ACTIVITY IN WINDOW — reporting a quiet week.");

    const quietEmbed = {
      title: `Pi digest — no activity (${quietWeekStart} to ${quietWeekEnd})`,
      description:
        "No Pi telemetry was recorded in this window, so there is nothing to measure. " +
        "Reported rather than skipped, so a quiet week and a broken pipeline do not look the same.",
      color: 0x808080,
      timestamp: now.toISOString(),
      footer: { text: loadDisplayName() },
    };

    // Dry run persists NOTHING: no report file, no history row. Checked before every write.
    if (dryRun) {
      console.log("\n[weekly-report] DRY RUN — quiet-week embed that WOULD be sent:\n");
      console.log(JSON.stringify(quietEmbed, null, 2));
      console.log("\n[weekly-report] Dry run complete. No POST sent.");
      return;
    }

    const quietDelivery = await deliverEmbed(quietEmbed);
    if (!quietDelivery.ok) {
      // No history row on failure: recording one would arm the 6-day guard and block the retry —
      // the same defect the normal path still has. See the note in harness-cleanup-plan.md.
      console.error("[weekly-report] Quiet week detected but not delivered. Exiting with error.");
      process.exit(1);
    }

    // Recorded only AFTER a successful post, so it arms the guard exactly when it should.
    saveHistory({
      week_start: quietWeekStart,
      week_end: quietWeekEnd,
      session_count: 0,
      commit_count: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_read_tokens: 0,
      total_cache_write_tokens: 0,
      spend: 0,
      skills_used: {},
    });
    console.log("[weekly-report] Quiet-week row recorded in history");
    return;
  }

  const allSkillNames = listSkills(config);
  const commitsByRepo = countCommitsByRepo(config);
  const commitCount = [...commitsByRepo.values()].reduce((s, c) => s + c, 0);
  const sessions = dedupeSessions(records, allSkillNames);

  console.log(
    `[weekly-report] ${sessions.length} sessions, ${commitCount} commits, ${allSkillNames.size} skills on disk`,
  );

  // 2. Analyze
  const history = loadHistory();
  const previousWeek = history.length > 0 ? history[history.length - 1] : null;

  // Logon-trigger guard: skip if a report was posted within the last 6 days,
  // so a run at every logon posts at most once a week. --force bypasses.
  const alreadyReported = recentlyReportedWeekEnd(previousWeek, forceRun);
  if (alreadyReported) {
    console.log(`[weekly-report] Already reported ${alreadyReported}. Skipping.`);
    return;
  }

  const metrics = computeMetrics(sessions, commitsByRepo, allSkillNames, history);

  // 3. Deterministic summary (no LLM — cannot hallucinate)
  const summary = buildSummary(metrics, history);

  // 4. Render
  const embed = buildEmbed(metrics, history, loadDisplayName(), summary);
  const markdown = buildMarkdown(metrics, history, loadDisplayName(), summary);

  // 4. Write local report (always)
  const reportDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${metrics.week_end}.md`);
  fs.writeFileSync(reportFile, markdown, "utf-8");
  console.log(`[weekly-report] Report written: ${reportFile}`);

  // 5. Persist history
  const skillUsageMap: Record<string, number> = {};
  for (const s of metrics.skill_usage) {
    skillUsageMap[s.skill] = s.sessions;
  }
  saveHistory({
    week_start: metrics.week_start,
    week_end: metrics.week_end,
    session_count: metrics.session_count,
    commit_count: metrics.commit_count,
    total_input_tokens: metrics.token_volumes.reduce((s, v) => s + v.input_tokens, 0),
    total_output_tokens: metrics.token_volumes.reduce((s, v) => s + v.output_tokens, 0),
    total_cache_read_tokens: metrics.token_volumes.reduce((s, v) => s + v.cache_read_tokens, 0),
    total_cache_write_tokens: metrics.token_volumes.reduce((s, v) => s + v.cache_write_tokens, 0),
    spend: metrics.actual_spend_total,
    skills_used: skillUsageMap,
  });
  console.log("[weekly-report] History updated");

  // 6. Deliver
  if (dryRun) {
    console.log("\n[weekly-report] DRY RUN — embed that WOULD be sent:\n");
    console.log(JSON.stringify(embed, null, 2));
    console.log("\n[weekly-report] Dry run complete. No POST sent.");
    return;
  }

  const delivery = await deliverEmbed(embed);
  if (!delivery.ok) {
    console.error("[weekly-report] Local report written. Exiting with error.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[weekly-report] Fatal error:", err);
  process.exit(1);
});
