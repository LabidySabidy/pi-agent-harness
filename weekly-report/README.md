# Weekly Report

Standalone, read-only script that reads harness telemetry and pushes a weekly digest (tokens, estimated spend, skill activity) to a private Discord channel.

**Stack:** TypeScript on Node, run via `tsx`.

## Quick start

```bash
# Install deps
npm install

# Dry run (writes local report, no Discord POST)
npm run dry

# Full run (writes report + posts to Discord)
npm run run

# Type-check
npm run typecheck
```

## What it reports

- **Activity:** session count, commit count, projects touched
- **Token volume:** input/output tokens by model
- **Estimated spend:** tokens × static price table, labeled "≈ estimated"
- **Skill usage:** sessions per skill (presence, not invocation frequency)
- **Retire candidates:** skills unused for 4+ weeks (advisory only)
- **Graduate candidates:** skills hitting usage threshold (v2)

## Configuration

Create `.secrets.json`:
```json
{
  "discordWebhookUrl": "https://discord.com/api/webhooks/..."
}
```

Or set env var `DISCORD_WEBHOOK_URL`.

## Scheduling

### Windows (Task Scheduler) — primary

```powershell
$action  = New-ScheduledTaskAction -Execute "node" `
  -Argument "$env:USERPROFILE\.pi\node_modules\.bin\tsx $env:USERPROFILE\.pi\weekly-report\report.ts"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8am
Register-ScheduledTask -TaskName "PiWeeklyReport" -Action $action -Trigger $trigger `
  -Description "Weekly harness digest to Discord"
```

### Mac (launchd) — secondary, disabled by default

```bash
# Edit: ~/Library/LaunchAgents/com.pi.weekly-report.plist
# StartAtLogin + StartCalendarInterval Monday 08:00
# Leave disabled unless Windows primary is offline.
```

## Failure modes

| Situation | Behavior |
|---|---|
| No telemetry | Posts "no telemetry this week" or skips; never crashes |
| Malformed JSONL line | Skipped; torn last line handled |
| Webhook failure | Local report already written; exits non-zero |
| HTTP 429 | Retries once after `retry_after`, then degrades |

The digest is never lost — worst case it's on disk at `reports/YYYY-MM-DD.md`.

## Design principles

- **Read-only** against harness data — never writes to agent/, memory files, skills, or config
- **Advisory only** — recommends retire/graduate, never edits skills
- **20/80** — v1 is a templated digest of real numbers; no LLM, no trend engine, no web UI
- **One machine** — run on Windows primary; Mac schedule documented but left disabled
