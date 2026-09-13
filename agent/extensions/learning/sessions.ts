/**
 * sessions.ts — pure session-record rendering.
 *
 * The session file is written at `session_start` with `status: open` so a
 * crashed session still leaves a record, and finalized at `session_end` (or by
 * the next `session_start`). Nothing here touches the filesystem.
 */
import type { MisconceptionRow, ReducedState } from "./events.ts";

export function sessionFileName(iso: string, sessionId: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  return `${date}-${time}-${sessionId.slice(0, 8)}.md`;
}

export function renderSessionMarkdown(
  state: ReducedState,
  sessionId: string,
  opts: { final: boolean },
): string {
  const session = [...state.sessions].reverse().find((s) => s.id === sessionId) ?? null;
  const startedAt = session?.startedAt ?? "unknown";
  const status = session?.endedAt ? "closed" : opts.final ? "closed" : "open";

  const lines: string[] = [
    `# Session ${sessionId.slice(0, 8)}`,
    "",
    `- **Status:** ${status}`,
    `- **Started:** ${startedAt}`,
  ];
  if (session?.endedAt) lines.push(`- **Ended:** ${session.endedAt}`);
  if (session?.sessionFile) lines.push(`- **Transcript:** ${session.sessionFile}`);
  if (typeof session?.turns === "number") lines.push(`- **Turns:** ${session.turns}`);

  const concepts = [...state.concepts.values()];
  lines.push("", "## Concepts touched", "");
  if (concepts.length === 0) {
    lines.push("_None recorded._");
  } else {
    for (const c of concepts) {
      const badge = c.badge ?? "—";
      const when = c.sm2 ? `next review in ${c.sm2.interval}d` : "no SM-2 update";
      lines.push(`- ${badge} **${c.name}** — ${when}`);
    }
  }

  const misconceptions: MisconceptionRow[] = [...state.misconceptions.values()];
  lines.push("", "## Misconceptions", "");
  if (misconceptions.length === 0) {
    lines.push("_None recorded._");
  } else {
    for (const m of misconceptions) {
      lines.push(`- \`${m.id}\` (${m.status}) ${m.concept}: ${m.description}`);
      if (m.corrected) lines.push(`  - corrected: ${m.corrected}`);
    }
  }

  lines.push("", "## Notes and decisions", "");
  if (state.journal.length === 0) {
    lines.push("_None recorded._");
  } else {
    for (const j of state.journal) lines.push(`- **${j.kind}** ${j.text}`);
  }

  if (state.missingTelemetry.length > 0) {
    lines.push("", "## Recorded gaps", "");
    for (const m of state.missingTelemetry) {
      lines.push(`- telemetry missing (${m.reason})${m.evidence ? `: ${m.evidence}` : ""}`);
    }
  }

  lines.push("", "## Next", "", "_(not recorded — fill in before the next session)_", "");
  return lines.join("\n");
}

/**
 * Sessions that started but never ended (crash, closed terminal). Their files
 * are rewritten as closed so the journal does not accumulate `status: open`
 * records forever.
 */
export function staleSessions(state: ReducedState, currentSessionId: string): string[] {
  return state.sessions
    .filter((s) => s.endedAt === null && s.id !== currentSessionId)
    .map((s) => s.id);
}
