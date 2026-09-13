/**
 * events.ts — the append-only learning event log and its pure reducer.
 *
 * Layer 1 of the three-layer model: `events.jsonl` is authoritative for
 * telemetry (badge, SM-2, misconceptions). SCHEMA.md stays authoritative for
 * authored prose and is a *projection* of this log.
 *
 * The reducer is pure and order-tolerant within a single writer: file order is
 * chronological, and replaying the whole log must always yield the same state.
 */
import type { Badge, Severity, Sm2, Telemetry } from "./telemetry.ts";

export type EventKind =
  | "session_start"
  | "session_end"
  | "badge"
  | "sm2"
  | "misconception_open"
  | "misconception_resolved"
  | "note"
  | "decision"
  | "telemetry_missing";

export const EVENT_VERSION = 1;

export interface LearningEvent {
  v: number;
  ts: string;
  kind: EventKind;
  session_id?: string | null;
  session_file?: string | null;
  cwd?: string;
  concept?: string;
  from?: Badge;
  to?: Badge;
  status?: Badge;
  sm2?: Sm2;
  id?: string;
  description?: string;
  corrected?: string;
  /** Tutor-emitted severity. Absent means unrated. */
  severity?: Severity;
  reason?: string;
  evidence?: string;
  text?: string;
  turns?: number;
  model?: string;
  concepts_touched?: string[];
  /** How the payload reached us: a validated tool call (preferred) or the legacy tag. */
  source?: "tool" | "tag";
}

export interface MisconceptionRow {
  id: string;
  concept: string;
  description: string;
  corrected: string;
  status: "open" | "resolved";
  date: string;
  /** `""` means unrated and is the backward-compatible default. */
  severity: Severity | "";
}

export interface ConceptState {
  name: string;
  badge: Badge | null;
  sm2: Sm2 | null;
  misconceptionIds: string[];
}

export interface SessionState {
  id: string;
  startedAt: string;
  endedAt: string | null;
  sessionFile: string | null;
  turns: number | null;
}

export interface ReducedState {
  concepts: Map<string, ConceptState>;
  misconceptions: Map<string, MisconceptionRow>;
  sessions: SessionState[];
  journal: { ts: string; kind: "note" | "decision"; text: string; concept?: string }[];
  missingTelemetry: { ts: string; reason: string; evidence?: string }[];
}

export function emptyState(): ReducedState {
  return {
    concepts: new Map(),
    misconceptions: new Map(),
    sessions: [],
    journal: [],
    missingTelemetry: [],
  };
}

export function serializeEvent(event: LearningEvent): string {
  return JSON.stringify(event) + "\n";
}

/**
 * Parse one log line. A malformed line yields null — the caller skips and logs
 * it rather than failing the whole projection.
 */
export function parseEventLine(line: string): LearningEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const e = parsed as Record<string, unknown>;
  if (typeof e.kind !== "string" || typeof e.ts !== "string") return null;
  if (!KINDS.has(e.kind as EventKind)) return null;
  return e as unknown as LearningEvent;
}

const KINDS = new Set<EventKind>([
  "session_start",
  "session_end",
  "badge",
  "sm2",
  "misconception_open",
  "misconception_resolved",
  "note",
  "decision",
  "telemetry_missing",
]);

function conceptKey(name: string): string {
  return name.trim().toLowerCase();
}

function ensureConcept(state: ReducedState, name: string): ConceptState {
  const key = conceptKey(name);
  let c = state.concepts.get(key);
  if (!c) {
    c = { name, badge: null, sm2: null, misconceptionIds: [] };
    state.concepts.set(key, c);
  }
  return c;
}

/**
 * Fold the log into current state. Replace-don't-accumulate throughout, so
 * replaying the same log any number of times yields an identical result.
 */
export function reduceEvents(events: LearningEvent[]): ReducedState {
  const state = emptyState();

  for (const e of events) {
    switch (e.kind) {
      case "session_start": {
        state.sessions.push({
          id: e.session_id ?? "unknown",
          startedAt: e.ts,
          endedAt: null,
          sessionFile: e.session_file ?? null,
          turns: null,
        });
        break;
      }
      case "session_end": {
        const open = [...state.sessions].reverse().find((s) => s.endedAt === null);
        if (open) {
          open.endedAt = e.ts;
          open.turns = typeof e.turns === "number" ? e.turns : null;
        }
        break;
      }
      case "badge": {
        if (!e.concept) break;
        const c = ensureConcept(state, e.concept);
        if (e.to) c.badge = e.to;
        break;
      }
      case "sm2": {
        if (!e.concept || !e.sm2) break;
        const c = ensureConcept(state, e.concept);
        c.sm2 = e.sm2;
        break;
      }
      case "misconception_open":
      case "misconception_resolved": {
        if (!e.id || !e.concept) break;
        const existing = state.misconceptions.get(e.id);
        const row: MisconceptionRow = existing ?? {
          id: e.id,
          concept: e.concept,
          description: e.description ?? "",
          corrected: "",
          status: "open",
          date: e.ts.slice(0, 10),
          severity: "",
        };
        if (e.kind === "misconception_open") {
          if (e.description) row.description = e.description;
        } else {
          row.status = "resolved";
          if (e.corrected) row.corrected = e.corrected;
        }
        // Severity is updatable on re-assessment, exactly like the corrected cell.
        // Only an explicit rating overwrites; an omitted field leaves the prior value.
        if (e.severity) row.severity = e.severity;
        state.misconceptions.set(e.id, row);

        const c = ensureConcept(state, row.concept);
        if (!c.misconceptionIds.includes(row.id)) c.misconceptionIds.push(row.id);
        break;
      }
      case "note":
      case "decision": {
        if (!e.text) break;
        state.journal.push({ ts: e.ts, kind: e.kind, text: e.text, concept: e.concept });
        break;
      }
      case "telemetry_missing": {
        state.missingTelemetry.push({
          ts: e.ts,
          reason: e.reason ?? "unspecified",
          evidence: e.evidence,
        });
        break;
      }
    }
  }

  return state;
}

/** Convenience: parse a whole log file body. Returns the events plus bad lines. */
export function parseEventLog(body: string): { events: LearningEvent[]; malformed: string[] } {
  const events: LearningEvent[] = [];
  const malformed: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const e = parseEventLine(line);
    if (e) events.push(e);
    else malformed.push(line);
  }
  return { events, malformed };
}

/**
 * Expand one validated telemetry payload into log events. Kept pure so the
 * expansion is testable without the extension runtime.
 */
export function telemetryToEvents(
  t: Telemetry,
  meta: {
    ts: string;
    session_id?: string | null;
    session_file?: string | null;
    cwd?: string;
    source: "tool" | "tag";
  },
): LearningEvent[] {
  const base = {
    v: EVENT_VERSION,
    ts: meta.ts,
    session_id: meta.session_id ?? null,
    session_file: meta.session_file ?? null,
    cwd: meta.cwd,
  };
  const out: LearningEvent[] = [
    { ...base, kind: "badge", concept: t.concept, to: t.status, status: t.status, source: meta.source },
    { ...base, kind: "sm2", concept: t.concept, sm2: t.sm2 },
  ];

  if (t.misconception) {
    out.push(
      t.misconception.status === "resolved"
        ? {
            ...base,
            kind: "misconception_resolved",
            concept: t.concept,
            id: t.misconception.id,
            corrected: t.misconception.corrected ?? "",
            severity: t.misconception.severity,
          }
        : {
            ...base,
            kind: "misconception_open",
            concept: t.concept,
            id: t.misconception.id,
            description: t.misconception.description,
            severity: t.misconception.severity,
          },
    );
  }

  if (t.note) out.push({ ...base, kind: "note", concept: t.concept, text: t.note });
  if (t.decision) out.push({ ...base, kind: "decision", concept: t.concept, text: t.decision });

  return out;
}
