/**
 * session-summary — Pi extension
 *
 * Pattern B: maintains a single "rolling" entry at the top of PROGRESS.md
 * that updates after every agent turn (`agent_end`). On `session_shutdown`
 * the entry is finalized (marker removed, timestamp set to "now").
 *
 * If shutdown never fires (terminal closed without exiting Pi), the rolling
 * entry stays in place. Next time a session starts, `session_start` finalizes
 * any stale rolling entries from prior sessions automatically.
 *
 * Net effect: PROGRESS.md always reflects the latest state of the most
 * recent session, no matter how the previous session ended.
 *
 * Install at: ~/.pi/agent/extensions/session-summary/index.ts
 *
 * v0 implementation: deterministic — extracts the last assistant message's
 * "end-of-output recap" if present, otherwise truncates to ~500 chars.
 * No LLM call.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const PROGRESS_FILENAME = "PROGRESS.md";
const MAX_SUMMARY_CHARS = 500;
const MIN_SESSION_ENTRIES = 3;

// Per-session state. Tracks which rolling entry belongs to *this* session.
let sessionStartIso: string | null = null;

export default function sessionSummary(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    sessionStartIso = new Date().toISOString();
    try {
      await finalizeStaleEntries(join(ctx.cwd, PROGRESS_FILENAME));
    } catch (err) {
      console.error("[session-summary] session_start finalize failed:", err);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    try {
      await updateRollingEntry(ctx, /* finalize */ false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`[ss] turn_end ERROR: ${msg}`, "error");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.notify("[session-summary] session_shutdown fired", "info");
    try {
      await updateRollingEntry(ctx, /* finalize */ true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`[session-summary] session_shutdown ERROR: ${msg}`, "error");
    }
  });
}

async function updateRollingEntry(
  ctx: { cwd: string; sessionManager: { getEntries: () => unknown[] }; ui: { notify: (msg: string, level: string) => void } },
  finalize: boolean
): Promise<void> {
  if (!sessionStartIso) sessionStartIso = new Date().toISOString();

  const entries = ctx.sessionManager.getEntries() as ReadonlyArray<{
    role?: string;
    content?: unknown;
    text?: string;
  }>;

  if (!entries || entries.length < MIN_SESSION_ENTRIES) return;

  const summary = summarizeEntries(entries);
  if (!summary) return;

  const progressPath = join(ctx.cwd, PROGRESS_FILENAME);
  const exists = await fileExists(progressPath);
  const current = exists
    ? await fs.readFile(progressPath, "utf8")
    : "# Progress\n\n> Rolling session summaries, newest first.\n";

  const headline = extractHeadline(summary);
  const timestamp = formatTimestamp(new Date());
  const startMarker = `<!-- session-in-progress:start=${sessionStartIso} -->`;
  const endMarker = `<!-- end-session-in-progress -->`;

  const block = finalize
    ? `\n## ${timestamp} — ${headline}\n${summary}\n`
    : `\n${startMarker}\n## ${timestamp} — ${headline} _(in progress)_\n${summary}\n${endMarker}\n`;

  // Check if our specific session's marker already exists
  const ourMarkerRegex = new RegExp(
    `\\n?${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}\\n?`,
    "g"
  );

  let next: string;
  if (ourMarkerRegex.test(current)) {
    // Replace the existing rolling entry
    next = current.replace(ourMarkerRegex, block);
  } else {
    // Insert at top (after the # heading + any blockquote)
    next = insertEntryAtTop(current, block);
  }

  await fs.writeFile(progressPath, next, "utf8");

  if (finalize) {
    sessionStartIso = null;
    ctx.ui.notify("PROGRESS.md updated with final session summary", "success");
  }
}

async function finalizeStaleEntries(progressPath: string): Promise<void> {
  const exists = await fileExists(progressPath);
  if (!exists) return;
  const current = await fs.readFile(progressPath, "utf8");
  // Strip all in-progress markers (orphaned from previous killed sessions).
  // The content itself stays — it just becomes a regular entry.
  const cleaned = current
    .replace(/<!-- session-in-progress:[^>]+-->\n?/g, "")
    .replace(/<!-- end-session-in-progress -->\n?/g, "")
    .replace(/\s_\(in progress\)_/g, "");
  if (cleaned !== current) {
    await fs.writeFile(progressPath, cleaned, "utf8");
  }
}

function summarizeEntries(
  entries: ReadonlyArray<Record<string, unknown>>
): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (getRole(e) !== "assistant") continue;
    const text = extractText(e);
    if (!text || text.trim().length < 50) continue;

    const recap = extractRecap(text);
    if (recap) return truncate(recap, MAX_SUMMARY_CHARS);

    return truncate(text, MAX_SUMMARY_CHARS);
  }
  return null;
}

function getRole(entry: Record<string, unknown>): string | undefined {
  // Pi's actual entry shape: { type, id, parentId, timestamp, message: { role, content } }
  const msg = entry["message"] as { role?: string } | undefined;
  if (msg?.role) return msg.role;
  if (typeof entry["role"] === "string") return entry["role"] as string;
  return undefined;
}

function extractText(entry: Record<string, unknown>): string {
  // Pi's actual shape: message.content (string or array of content blocks)
  const msg = entry["message"] as { content?: unknown } | undefined;
  if (msg && msg.content !== undefined) {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((c: unknown) => {
          if (typeof c === "string") return c;
          if (typeof c === "object" && c !== null) {
            const block = c as { type?: string; text?: string };
            // Anthropic-style blocks: { type: "text", text: "..." }
            // Skip tool_use / tool_result blocks
            if (block.type === "text" || (!block.type && block.text)) {
              return block.text ?? "";
            }
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
  }
  // Fallback for other shapes
  if (typeof entry["text"] === "string") return entry["text"] as string;
  if (typeof entry["content"] === "string") return entry["content"] as string;
  return "";
}

function extractRecap(text: string): string | null {
  const recapMatch = text.match(
    /(?:^|\n)##\s*(?:Recap|Done|Summary|What changed)[\s\S]+?$/i
  );
  if (recapMatch) return recapMatch[0].trim();

  const paragraphs = text.split(/\n{2,}/);
  const last = paragraphs[paragraphs.length - 1]?.trim() ?? "";
  if (
    last.length > 30 &&
    /\b(changed|verified|done|fixed|added|updated|next)\b/i.test(last)
  ) {
    return last;
  }
  return null;
}

function extractHeadline(summary: string): string {
  const firstSentence = summary.split(/[.!?]\s+/)[0] ?? summary;
  return firstSentence.length > 80
    ? firstSentence.slice(0, 80) + "..."
    : firstSentence;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function insertEntryAtTop(current: string, entry: string): string {
  const headerEnd = current.match(/^(?:#[^\n]*\n+(?:>\s[^\n]*\n+)*)/);
  if (headerEnd) {
    const splitAt = headerEnd[0].length;
    return current.slice(0, splitAt) + entry + current.slice(splitAt);
  }
  return entry + "\n" + current;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
