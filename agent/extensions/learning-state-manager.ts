/**
 * learning-state-manager.ts
 *
 * Socratic telemetry pipeline: extract <learning-telemetry> blocks from the
 * assistant's final message, validate them defensively, write badge + SM-2 +
 * misconception state back to <project>/.agent/learning/SCHEMA.md, and strip
 * the raw JSON from what the user sees.
 *
 * NOTE: hooks `message_end` (assistant role) rather than `turn_end` because the
 * extension API only supports returning a replacement message from `message_end`.
 * `turn_end` is notification-only (event.message/event.toolResults, no return).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const BADGES = ["🟥", "🟨", "🟩", "🟦"] as const;
type Badge = (typeof BADGES)[number];

const BADGE_LABEL: Record<Badge, string> = {
  "🟥": "Weak",
  "🟨": "Fair",
  "🟩": "Good",
  "🟦": "Mastered",
};

// Emoji are multi-code-unit; NEVER put them in a [] character class.
const BADGE_ALT = "(?:🟥|🟨|🟩|🟦|⬜)";

interface Sm2 {
  interval: number;
  ease_factor: number;
  repetitions: number;
}

interface Misconception {
  id: string;
  description: string;
  status: "open" | "resolved";
}

interface Telemetry {
  concept: string;
  status: Badge;
  sm2: Sm2;
  misconception?: Misconception;
}

const TELEMETRY_RE = /<learning-telemetry>([\s\S]*?)<\/learning-telemetry>/g;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeJson(raw: string): string {
  let s = raw.trim();
  // strip markdown code fences (```json / ```)
  s = s.replace(/^```(?:json|JSON)?\s*$/gm, "");
  s = s.replace(/^```\s*$/gm, "");
  // strip trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s.trim();
}

// ---------------------------------------------------------------------------
// Type guard + self-healing defaults
// ---------------------------------------------------------------------------

function isBadge(v: unknown): v is Badge {
  return typeof v === "string" && (BADGES as readonly string[]).includes(v);
}

function toNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function validateTelemetry(data: unknown): Telemetry | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  if (typeof d.concept !== "string" || d.concept.trim() === "") return null;
  if (!isBadge(d.status)) return null;

  const sm2Raw =
    typeof d.sm2 === "object" && d.sm2 !== null
      ? (d.sm2 as Record<string, unknown>)
      : {};

  // Self-healing: missing / non-numeric SM-2 fields fall back to defaults.
  const sm2: Sm2 = {
    interval: toNumber(sm2Raw.interval) ?? 1,
    ease_factor: toNumber(sm2Raw.ease_factor) ?? 2.5,
    repetitions: toNumber(sm2Raw.repetitions) ?? 1,
  };

  let misconception: Misconception | undefined;
  if (typeof d.misconception === "object" && d.misconception !== null) {
    const m = d.misconception as Record<string, unknown>;
    if (typeof m.id === "string" && typeof m.description === "string") {
      misconception = {
        id: m.id,
        description: m.description,
        status: m.status === "resolved" ? "resolved" : "open",
      };
    }
  }

  return { concept: d.concept.trim(), status: d.status, sm2, misconception };
}

// ---------------------------------------------------------------------------
// Extraction (works for string content and content arrays)
// ---------------------------------------------------------------------------

export function extractTelemetry(text: string): { blocks: string[]; cleaned: string } {
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  TELEMETRY_RE.lastIndex = 0;
  while ((m = TELEMETRY_RE.exec(text)) !== null) {
    blocks.push(m[1]);
  }
  const cleaned = text.replace(TELEMETRY_RE, "");
  return { blocks, cleaned };
}

function extractAndClean(content: unknown): {
  telemetryBlocks: string[];
  cleanedContent: unknown;
} {
  if (typeof content === "string") {
    const { blocks, cleaned } = extractTelemetry(content);
    return { telemetryBlocks: blocks, cleanedContent: cleaned };
  }
  if (Array.isArray(content)) {
    const telemetryBlocks: string[] = [];
    const cleanedContent = content.map((block: any) => {
      if (block && block.type === "text" && typeof block.text === "string") {
        const { blocks, cleaned } = extractTelemetry(block.text);
        telemetryBlocks.push(...blocks);
        return blocks.length > 0 ? { ...block, text: cleaned } : block;
      }
      return block;
    });
    return { telemetryBlocks, cleanedContent };
  }
  return { telemetryBlocks: [], cleanedContent: content };
}

// ---------------------------------------------------------------------------
// SCHEMA.md mutation
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function findConceptCard(
  text: string,
  concept: string,
): { start: number; end: number; block: string; name: string } | null {
  const variants = [
    concept,
    concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  ];
  for (const v of variants) {
    if (!v) continue;
    const headingRe = new RegExp(
      `^(### )${BADGE_ALT}( ${escapeRegExp(v)}[ \\t]*)$`,
      "m",
    );
    const m = headingRe.exec(text);
    if (!m) continue;
    const start = m.index;
    const name = m[2].trim(); // canonical heading name (may differ from input concept)
    const nextHeading = text.indexOf("\n### ", start + 1);
    const endMarker = text.indexOf("<!-- /CONCEPT CARD -->", start);
    const candidates = [nextHeading, endMarker].filter((i) => i !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : text.length;
    return { start, end, block: text.slice(start, end), name };
  }
  return null;
}

export function updateSchema(ctx: any, t: Telemetry): void {
  const schemaPath = join(ctx.cwd, ".agent", "learning", "SCHEMA.md");
  if (!existsSync(schemaPath)) {
    logError(ctx, "SCHEMA.md not found", new Error(`missing ${schemaPath}`), "");
    return;
  }
  let text = readFileSync(schemaPath, "utf8");

  const card = findConceptCard(text, t.concept);
  if (!card) {
    logError(
      ctx,
      "concept not found in SCHEMA.md",
      new Error(`no card for "${t.concept}"`),
      "",
    );
    return;
  }

  const today = isoDate(new Date());
  const next = isoDate(addDays(new Date(), t.sm2.interval));
  const name = card.name;

  let block = card.block;

  // badge in heading: ### <badge> <concept>
  const headingRe = new RegExp(
    `^(### )${BADGE_ALT}( ${escapeRegExp(name)}[ \\t]*)$`,
    "m",
  );
  block = block.replace(headingRe, `$1${t.status}$2`);

  // status line
  block = block.replace(
    /(- \*\*Status:\*\* )(?:🟥|🟨|🟩|🟦|⬜)( [A-Za-z]+)/,
    `$1${t.status} ${BADGE_LABEL[t.status]}`,
  );

  // SM-2 fields (scoped to this card)
  block = block.replace(/(`last_tested`: ).*/m, `$1${today}`);
  block = block.replace(/(`next_review`: ).*/m, `$1${next}`);
  block = block.replace(/(`interval`: ).*/m, `$1${t.sm2.interval}`);
  block = block.replace(/(`ease_factor`: ).*/m, `$1${t.sm2.ease_factor}`);
  block = block.replace(/(`repetitions`: ).*/m, `$1${t.sm2.repetitions}`);

  // misconception pointer on the card
  if (t.misconception) {
    const id = t.misconception.id;
    block = block.replace(
      /(- \*\*Misconceptions:\*\*)(.*)/m,
      (_m: string, prefix: string, rest: string) => {
        const current = rest.trim();
        if (current.includes(id)) return _m;
        const cleaned =
          current === "—" || current.startsWith("<") ? "" : current;
        const merged = [cleaned, id].filter(Boolean).join(", ");
        return `${prefix} ${merged || "—"}`;
      },
    );
  }

  // rebuild document with the mutated card
  text = text.slice(0, card.start) + block + text.slice(card.end);

  // misconception registry row (section 3)
  if (t.misconception) {
    const regSep =
      "|----|---------|---------------------------------|-------------------------------|--------|------|";
    if (text.includes(regSep)) {
      const row = `| ${t.misconception.id} | ${name} | ${sanitizeCell(
        t.misconception.description,
      )} |  | ${t.misconception.status} | ${today} |`;
      text = text.replace(regSep, regSep + "\n" + row);
    }
  }

  // SM-2 summary table (section 4)
  const rowRe = new RegExp(
    `^(\\| ${escapeRegExp(name)} \\|).*$`,
    "m",
  );
  if (rowRe.test(text)) {
    const newRow = `| ${name} | ${today} | ${next} | ${t.sm2.interval} | ${t.sm2.ease_factor} | ${t.sm2.repetitions} |`;
    text = text.replace(rowRe, () => newRow);
  }

  writeFileSync(schemaPath, text, "utf8");
}

// ---------------------------------------------------------------------------
// Error logging
// ---------------------------------------------------------------------------

function logError(
  ctx: any,
  reason: string,
  err: unknown,
  raw: string,
): void {
  try {
    const dir = join(ctx.cwd, ".agent", "learning");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "telemetry-errors.log");
    const errText = err instanceof Error ? err.stack ?? err.message : String(err);
    const rawText = (raw || "").replace(/\s+/g, " ").trim();
    const line = `[${new Date().toISOString()}] reason=${reason} error=${errText} raw=${rawText}`;
    appendFileSync(file, line + "\n", "utf8");
  } catch {
    /* never throw from the logger */
  }
}

function processBlock(raw: string, ctx: any): void {
  const normalized = normalizeJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (err) {
    logError(ctx, "JSON parse failed", err, raw);
    return;
  }
  const telemetry = validateTelemetry(parsed);
  if (!telemetry) {
    logError(ctx, "type-guard rejected payload", new Error("invalid shape"), raw);
    return;
  }
  try {
    updateSchema(ctx, telemetry);
  } catch (err) {
    logError(ctx, "SCHEMA.md update failed", err, raw);
  }
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.on("message_end", async (event: any, ctx: any) => {
    try {
      const message = event?.message;
      if (!message || message.role !== "assistant") return;

      const { telemetryBlocks, cleanedContent } = extractAndClean(message.content);
      if (telemetryBlocks.length === 0) return;

      for (const raw of telemetryBlocks) {
        processBlock(raw, ctx);
      }

      // strip the raw JSON block from what the user sees, always
      return { message: { ...message, content: cleanedContent } };
    } catch (err) {
      try {
        logError(ctx, "unhandled extension error", err, "");
      } catch {
        /* ignore */
      }
    }
  });
}
