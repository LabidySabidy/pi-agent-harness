/**
 * index.ts — learning extension entry point.
 *
 * Three-layer persistence for a learning course:
 *   layer 0  pi's own session transcript (untouched, referenced by path)
 *   layer 1  <course>/.agent/learning/events.jsonl — append-only, authoritative
 *   layer 2  SCHEMA.md + SESSIONS/*.md — projections, rebuildable from layer 1
 *
 * The session record is written from hooks, so it exists even when the tutor
 * emits nothing. Model-supplied telemetry only enriches it, and its absence is
 * recorded (`telemetry_missing`) rather than silently ignored.
 */
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  extractAndClean,
  normalizeJson,
  validateTelemetry,
  type Telemetry,
} from "./telemetry.ts";
import {
  EVENT_VERSION,
  reduceEvents,
  telemetryToEvents,
  type LearningEvent,
} from "./events.ts";
import { projectSchema } from "./schema.ts";
import { detectGrillTurn } from "./signal.ts";
import { renderSessionMarkdown, sessionFileName, staleSessions } from "./sessions.ts";
import {
  appendEvent,
  appendEvents,
  isCourseDir,
  noteProblem,
  readEvents,
  readSchema,
  writeSchema,
  writeSessionFile,
} from "./io.ts";

interface SessionState {
  id: string;
  file: string | null;
  startedAt: string;
  fileName: string;
  turns: number;
}

interface Ctx {
  cwd: string;
  sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
    getEntries(): unknown[];
  };
  ui: { notify(message: string, type?: string): void };
}

let session: SessionState | null = null;
let telemetryThisTurn = false;

const iso = () => new Date().toISOString();
const today = () => iso().slice(0, 10);

/** Re-read the log, re-derive state, and rewrite SCHEMA.md's owned regions. */
function projectSchemaFile(cwd: string): string[] {
  const schema = readSchema(cwd);
  if (!schema) {
    noteProblem(cwd, "reason=no-schema", "events recorded, projection skipped");
    return ["no-schema"];
  }
  const { events, malformed } = readEvents(cwd);
  if (malformed.length > 0) {
    noteProblem(cwd, "reason=malformed-log-lines", `count=${malformed.length}`);
  }
  const state = reduceEvents(events);
  const result = projectSchema(schema, state, { today: today() });
  if (result.text !== schema) writeSchema(cwd, result.text);
  if (result.warnings.length > 0) {
    noteProblem(cwd, "reason=projection-warnings", result.warnings.join(" "));
  }
  return result.warnings;
}

function writeSession(cwd: string, s: SessionState, final: boolean): void {
  const { events } = readEvents(cwd);
  const state = reduceEvents(events);
  writeSessionFile(cwd, s.fileName, renderSessionMarkdown(state, s.id, { final }));
}

/** Append validated telemetry as events, then re-project. */
function applyTelemetry(ctx: Ctx, t: Telemetry, source: "tool" | "tag"): void {
  const events = telemetryToEvents(t, {
    ts: iso(),
    session_id: session?.id ?? null,
    session_file: session?.file ?? null,
    cwd: ctx.cwd,
    source,
  });
  appendEvents(ctx.cwd, events);
  telemetryThisTurn = true;
  projectSchemaFile(ctx.cwd);
}

export default function learning(pi: ExtensionAPI) {
  // --- the preferred path: a schema-validated tool call ---------------------
  pi.registerTool(
    defineTool({
      name: "record_learning",
      label: "Record learning",
      description:
        "Record learning telemetry for a concept: its mastery badge, SM-2 review state, and any " +
        "misconception detected or resolved. Call this once at the end of a grill or recitation turn.",
      promptSnippet: "Record mastery/SM-2/misconception state for a concept",
      promptGuidelines: [
        "After a grill-misconception or feynman-recite turn, call record_learning exactly once for the concept that changed.",
        "Use a bare emoji for status: 🟥 Weak, 🟨 Fair, 🟩 Good, 🟦 Mastered.",
      ],
      parameters: Type.Object({
        concept: Type.String({ description: "The concept card name from SCHEMA.md" }),
        status: Type.Union(
          [Type.Literal("🟥"), Type.Literal("🟨"), Type.Literal("🟩"), Type.Literal("🟦")],
          { description: "Mastery badge after this turn" },
        ),
        sm2: Type.Optional(
          Type.Object({
            interval: Type.Number(),
            ease_factor: Type.Number(),
            repetitions: Type.Number(),
          }),
        ),
        misconception: Type.Optional(
          Type.Object({
            id: Type.String({ description: "Stable id, e.g. MIS-003" }),
            description: Type.String({ description: "What the learner believed" }),
            status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("resolved")])),
            corrected: Type.Optional(
              Type.String({ description: "The corrected model in the learner's own words" }),
            ),
          }),
        ),
        note: Type.Optional(Type.String()),
        decision: Type.Optional(Type.String()),
      }),
      async execute(_id: string, params: unknown, _signal, _onUpdate, ctx: Ctx) {
        const t = validateTelemetry(params);
        if (!t) {
          noteProblem(ctx.cwd, "reason=tool-payload-rejected", JSON.stringify(params));
          return {
            content: [
              {
                type: "text",
                text: "Rejected: concept and status are required, and status must be one of 🟥🟨🟩🟦.",
              },
            ],
          };
        }
        applyTelemetry(ctx, t, "tool");
        return {
          content: [{ type: "text", text: `Recorded ${t.concept} ${t.status}${t.misconception ? ` + ${t.misconception.id}` : ""}.` }],
        };
      },
    }),
  );

  // --- deterministic session record ----------------------------------------
  pi.on("session_start", async (_event: unknown, ctx: Ctx) => {
    const now = iso();
    const id = ctx.sessionManager.getSessionId();
    session = {
      id,
      file: ctx.sessionManager.getSessionFile() ?? null,
      startedAt: now,
      fileName: sessionFileName(now, id),
      turns: 0,
    };
    if (!isCourseDir(ctx.cwd)) return;

    // finalize anything left open by a session that never shut down cleanly
    const { events } = readEvents(ctx.cwd);
    const state = reduceEvents(events);
    for (const staleId of staleSessions(state, id)) {
      const stale = state.sessions.find((s) => s.id === staleId);
      if (!stale) continue;
      writeSessionFile(
        ctx.cwd,
        sessionFileName(stale.startedAt, stale.id),
        renderSessionMarkdown(state, stale.id, { final: true }),
      );
    }

    appendEvent(ctx.cwd, {
      v: EVENT_VERSION,
      ts: now,
      kind: "session_start",
      session_id: id,
      session_file: session.file,
      cwd: ctx.cwd,
    });
    writeSession(ctx.cwd, session, false);
  });

  // --- telemetry: strip it from the visible message and persist it ----------
  pi.on("message_end", async (event: any, ctx: Ctx) => {
    const message = event?.message;
    if (!message || message.role !== "assistant") return;

    const { telemetryBlocks, cleanedContent } = extractAndClean(message.content);
    if (telemetryBlocks.length === 0) return;

    for (const raw of telemetryBlocks) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(normalizeJson(raw));
      } catch (err) {
        noteProblem(ctx.cwd, "reason=telemetry-json-invalid", err instanceof Error ? err.message : String(err));
        continue;
      }
      const t = validateTelemetry(parsed);
      if (!t) {
        noteProblem(ctx.cwd, "reason=telemetry-shape-rejected", raw);
        continue;
      }
      try {
        applyTelemetry(ctx, t, "tag");
      } catch (err) {
        noteProblem(ctx.cwd, "reason=apply-failed", err instanceof Error ? err.message : String(err));
      }
    }

    telemetryThisTurn = true;
    return { message: { ...message, content: cleanedContent } };
  });

  // --- turn bookkeeping and the recorded gap -------------------------------
  pi.on("turn_end", async (_event: unknown, ctx: Ctx) => {
    if (!session) return;
    session.turns += 1;

    if (!telemetryThisTurn && isCourseDir(ctx.cwd)) {
      const signal = detectGrillTurn(ctx.sessionManager.getEntries());
      if (signal.active) {
        const ts = iso();
        appendEvent(ctx.cwd, {
          v: EVENT_VERSION,
          ts,
          kind: "telemetry_missing",
          session_id: session.id,
          session_file: session.file,
          cwd: ctx.cwd,
          reason: "grill-turn-without-telemetry",
          evidence: signal.evidence,
        });
        noteProblem(ctx.cwd, "reason=telemetry-missing", `skill=${signal.evidence}`);
      }
    }
    telemetryThisTurn = false;
  });

  // --- close the session ---------------------------------------------------
  pi.on("session_shutdown", async (_event: unknown, ctx: Ctx) => {
    if (!session) return;
    if (isCourseDir(ctx.cwd)) {
      appendEvent(ctx.cwd, {
        v: EVENT_VERSION,
        ts: iso(),
        kind: "session_end",
        session_id: session.id,
        session_file: session.file,
        cwd: ctx.cwd,
        turns: session.turns,
      });
      try {
        writeSession(ctx.cwd, session, true);
        projectSchemaFile(ctx.cwd);
      } catch (err) {
        noteProblem(ctx.cwd, "reason=shutdown-write-failed", err instanceof Error ? err.message : String(err));
      }
    }
    session = null;
  });
}
