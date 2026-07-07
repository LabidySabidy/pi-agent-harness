/**
 * extract-patterns — Pi extension
 *
 * Fires on agent_end (incremental) and session_shutdown (safety net).
 * Scans assistant messages for project-specific patterns worth adding to
 * LESSONS.md. Writes candidates to <project>/.agent/lessons-pending.md
 * for user review (does NOT auto-add).
 *
 * Install at: ~/.pi/agent/extensions/extract-patterns/index.ts
 *
 * v0: deterministic — marker-phrase regex scan.
 * v1 upgrade path: replace extractCandidates with an LLM call.
 *
 * === Changes on 2026-05-05 ===
 * - Added agent_end hook alongside session_shutdown
 * - Incremental scanning via .agent/.extract-state.json
 * - Code fence stripping before regex matching
 * - Tool content filtering (tool_use / tool_result blocks)
 * - Dedup against existing lessons-pending.md and LESSONS.md
 * - Silent operation — no console output, no notification
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PENDING_FILENAME = ".agent/lessons-pending.md";
const LESSONS_FILENAME = "LESSONS.md";
const STATE_FILENAME = ".agent/.extract-state.json";
// Fewer than 3 entries = session barely started, no meaningful content to scan
const MIN_SESSION_ENTRIES = 3;

interface Candidate {
  category: string;
  text: string;
  context: string;
}

interface StateFile {
  lastProcessedEntryId: string | null;
}

const MARKERS: Array<{ category: string; pattern: RegExp }> = [
  {
    category: "Danger zones",
    pattern:
      /(?:^|[.!?]\s+|\*\*)(?:danger|watch\s+out|careful|risky|never|fragile|breaks\s+if|fails\s+when)\b[^.!?\n]{10,200}[.!?]/gim,
  },
  {
    category: "Gotchas",
    pattern:
      /(?:^|[.!?]\s+|\*\*)(?:gotcha|caveat|note\s+that|be\s+aware|easy\s+to\s+miss|surprising|counterintuitive)\b[^.!?\n]{10,200}[.!?]/gim,
  },
  {
    category: "Decisions made",
    pattern:
      /(?:^|[.!?]\s+|\*\*)(?:we\s+decided|chose\s+to|going\s+with|opted\s+for|decision[:.]|rationale[:.])\b[^.!?\n]{10,200}[.!?]/gim,
  },
  {
    category: "Anti-patterns",
    pattern:
      /(?:^|[.!?]\s+|\*\*)(?:don't|do\s+not|avoid|anti-?pattern|bad\s+idea|wrong\s+way)\b[^.!?\n]{10,200}[.!?]/gim,
  },
  {
    category: "Always do",
    pattern:
      /(?:^|[.!?]\s+|\*\*)(?:always|must|required\s+to)\b[^.!?\n]{10,200}[.!?]/gim,
  },
];

// ---------------------------------------------------------------------------
// Entry type — what SessionManager.getEntries() actually returns
// ---------------------------------------------------------------------------

interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: {
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function extractPatterns(pi: ExtensionAPI) {
  // Shared handler — both hooks call this
  const processNewEntries = async (ctx: {
    cwd: string;
    sessionManager: { getEntries: () => unknown[] };
  }) => {
    try {
      const entries = ctx.sessionManager.getEntries() as ReadonlyArray<SessionEntry>;
      if (!entries || entries.length < MIN_SESSION_ENTRIES) return;

      // Read incremental state
      const statePath = join(ctx.cwd, STATE_FILENAME);
      const state = await readState(statePath);
      const lastId = state.lastProcessedEntryId;

      // Find start index: entries are append-only, so find the first entry after lastId
      let startIndex = 0;
      if (lastId !== null) {
        const idx = entries.findIndex((e) => e.id === lastId);
        if (idx !== -1) {
          startIndex = idx + 1; // start AFTER the last processed entry
        }
        // If lastId not found (e.g., session reloaded, different file): scan all
      }

      // Extract candidates from new entries only
      const newEntries = entries.slice(startIndex);
      if (newEntries.length === 0) return;

      const candidates = extractCandidates(newEntries);
      if (candidates.length === 0) return;

      // Dedup: within batch + against existing files
      const lessonsPendingPath = join(ctx.cwd, PENDING_FILENAME);
      const lessonsPath = join(ctx.cwd, LESSONS_FILENAME);
      const filtered = await dedupeAndFilter(
        candidates,
        lessonsPendingPath,
        lessonsPath
      );
      if (filtered.length === 0) return;

      // Write
      await writeCandidates(lessonsPendingPath, filtered);

      // Update state to point to the last entry we scanned
      const lastEntry = entries[entries.length - 1];
      await writeState(statePath, { lastProcessedEntryId: lastEntry.id });
    } catch (err) {
      console.error("[extract-patterns] failed:", err);
    }
  };

  // Hook 1: incremental — fires after every agent turn
  pi.on("agent_end", async (_event, ctx) => {
    await processNewEntries(ctx);
  });

  // Hook 2: final sweep — safety net on session shutdown
  pi.on("session_shutdown", async (_event, ctx) => {
    await processNewEntries(ctx);
  });
}

// ---------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------

function extractCandidates(
  entries: ReadonlyArray<SessionEntry>
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const entry of entries) {
    // Only assistant messages
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "assistant") continue;

    const text = extractText(entry);
    if (!text) continue;

    // Strip code fences: remove ``` delimited blocks before matching
    const cleaned = stripCodeFences(text);
    if (cleaned.length < 20) continue;

    for (const { category, pattern } of MARKERS) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      const matches = cleaned.matchAll(pattern);
      for (const m of matches) {
        const matchText = m[0].trim();
        if (matchText.length < 20 || matchText.length > 300) continue;

        // Mechanical garbage filter — rejects on detectable signals only.
        // Does NOT judge lesson quality (that's the intake gate's job).
        if (isGarbageCandidate(matchText)) continue;

        candidates.push({
          category,
          text: matchText,
          context: getContext(cleaned, m.index ?? 0, 200),
        });
      }
    }
  }
  return candidates;
}

function extractText(entry: SessionEntry): string {
  const msg = entry.message;
  if (!msg) return "";

  const content = msg.content;
  if (content === undefined) return "";

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (typeof c === "object" && c !== null) {
          // Skip tool-related blocks
          if (c.type === "tool_use" || c.type === "tool_result") return "";
          if (c.type === "text" || (!c.type && c.text)) {
            return c.text ?? "";
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

// ---------------------------------------------------------------------------
// Code fence stripping
// ---------------------------------------------------------------------------

function stripCodeFences(text: string): string {
  // Remove ```...``` blocks including language specifiers
  return text.replace(/```[\s\S]*?```/g, "");
}

// ---------------------------------------------------------------------------
// Mechanical garbage filter — rejects on detectable signals only.
// Does NOT judge lesson quality. Division of labor:
//   extraction rejects detectable garbage (this),
//   intake judges quality (human, at the gate).
// ---------------------------------------------------------------------------

function isGarbageCandidate(text: string): boolean {
  // Truncated: ends mid-word or without terminal punctuation.
  // Detects fragments like "the static screen" or "must include:"
  const hasTerminator = /[.!?:)"']\s*$/.test(text);
  const endsWithEllipsis = /\.\.\.\s*$/.test(text);
  if (!hasTerminator && !endsWithEllipsis) {
    // Check if we ended mid-word (last char is alphanumeric)
    const lastChar = text.replace(/\s+$/, '').slice(-1);
    if (/[a-zA-Z0-9]/.test(lastChar)) return true;
  }

  // Too short: fewer than 5 words or < 30 chars
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 5 || text.length < 30) return true;

  // Mostly code/URL/path: > 30% of the text is URLs, file paths, or code.
  const urlCount = (text.match(/https?:\/\/[^\s]+/g) || []).length;
  const pathCount = (text.match(/[~/\w]+\/[\w./-]+/g) || []).length;
  const codeCount = (text.match(/`[^`]+`/g) || []).length;
  const fragmentChars = (text.match(/https?:\/\/[^\s]+|[~/\w]+\/[\w./-]+|`[^`]+`/g) || [])
    .reduce((sum, s) => sum + s.length, 0);
  if (fragmentChars > text.length * 0.3) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Context window for match display
// ---------------------------------------------------------------------------

function getContext(text: string, index: number, window: number): string {
  const start = Math.max(0, index - window / 2);
  const end = Math.min(text.length, index + window / 2);
  return text.slice(start, end).trim();
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

async function dedupeAndFilter(
  candidates: Candidate[],
  pendingPath: string,
  lessonsPath: string
): Promise<Candidate[]> {
  // Stage 1: dedup within batch
  const seen = new Set<string>();
  const stage1: Candidate[] = [];
  for (const c of candidates) {
    const key = c.category + "::" + c.text.toLowerCase().slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);

    // Filter obviously-generic LLM scaffolding language
    if (
      /\b(?:as an? (?:AI|assistant)|i can(?:not)?|i'?ll|let me know|feel free|hope this helps)\b/i.test(
        c.text
      )
    ) {
      continue;
    }

    stage1.push(c);
  }

  if (stage1.length === 0) return [];

  // Stage 2: dedup against existing lessons-pending.md entries
  const existingPending = await loadCandidateTexts(pendingPath);
  const stage2 = stage1.filter((c) => {
    const normalized = c.text.toLowerCase().slice(0, 200);
    return !existingPending.some(
      (existing) => existing.toLowerCase().slice(0, 200) === normalized
    );
  });

  if (stage2.length === 0) return [];

  // Stage 3 (optional): dedup against LESSONS.md entries
  const existingLessons = await loadCandidateTexts(lessonsPath);
  if (existingLessons.length > 0) {
    return stage2.filter((c) => {
      const normalized = c.text.toLowerCase().slice(0, 200);
      return !existingLessons.some(
        (existing) => existing.toLowerCase().slice(0, 200) === normalized
      );
    });
  }

  return stage2;
}

/**
 * Parse a markdown file for candidate texts (lines starting with "- [ ] " or "- [x] ").
 * Works for both lessons-pending.md and LESSONS.md.
 */
async function loadCandidateTexts(filePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n");
    return lines
      .filter((line) => /^\s*- \[[ x]\] /.test(line))
      .map((line) => line.replace(/^\s*- \[[ x]\] /, "").trim())
      .filter((t) => t.length > 0);
  } catch {
    return []; // File doesn't exist — no dedup needed
  }
}

// ---------------------------------------------------------------------------
// Write candidates
// ---------------------------------------------------------------------------

async function writeCandidates(
  filePath: string,
  candidates: Candidate[]
): Promise<void> {
  await ensureDir(dirname(filePath));

  const timestamp = formatTimestamp(new Date());
  const block = formatBlock(timestamp, candidates);

  const exists = await fileExists(filePath);
  if (exists) {
    const current = await fs.readFile(filePath, "utf8");
    await fs.writeFile(filePath, current + "\n" + block, "utf8");
  } else {
    const header =
      "# Pending lessons (review and add to LESSONS.md if useful)\n\n" +
      "> Auto-extracted candidates from sessions. Each entry is a heuristic match — review before promoting to LESSONS.md.\n";
    await fs.writeFile(filePath, header + "\n" + block, "utf8");
  }
  // Silent — no notification, no console output
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatBlock(timestamp: string, candidates: Candidate[]): string {
  const grouped = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = grouped.get(c.category) ?? [];
    arr.push(c);
    grouped.set(c.category, arr);
  }

  let out = `## ${timestamp} — extracted candidates\n`;
  for (const [category, items] of grouped) {
    out += `\n### ${category}\n`;
    for (const item of items) {
      out += `- [ ] ${item.text}\n`;
      if (item.context && item.context !== item.text) {
        out += `  > ${item.context.slice(0, 150)}\n`;
      }
    }
  }
  return out;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// State file read/write
// ---------------------------------------------------------------------------

async function readState(filePath: string): Promise<StateFile> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (typeof parsed.lastProcessedEntryId === "string" ||
        parsed.lastProcessedEntryId === null)
    ) {
      return parsed as StateFile;
    }
    return { lastProcessedEntryId: null };
  } catch {
    return { lastProcessedEntryId: null };
  }
}

async function writeState(
  filePath: string,
  state: StateFile
): Promise<void> {
  await ensureDir(dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
