/**
 * io.ts — the only impure part of the learning extension.
 *
 * Everything interesting already lives in the pure modules; this file just
 * moves bytes. Keeping it thin is what makes the rest testable.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLog, serializeEvent, type LearningEvent } from "./events.ts";
import { sessionFileName } from "./sessions.ts";

export function learningDir(cwd: string): string {
  return join(cwd, ".agent", "learning");
}

export function eventsPath(cwd: string): string {
  return join(learningDir(cwd), "events.jsonl");
}

export function schemaPath(cwd: string): string {
  return join(learningDir(cwd), "SCHEMA.md");
}

export function sessionsDir(cwd: string): string {
  return join(learningDir(cwd), "SESSIONS");
}

export function isCourseDir(cwd: string): boolean {
  return existsSync(learningDir(cwd));
}

export function readSchema(cwd: string): string | null {
  const p = schemaPath(cwd);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

export function writeSchema(cwd: string, text: string): void {
  writeFileSync(schemaPath(cwd), text, "utf8");
}

export function appendEvent(cwd: string, event: LearningEvent): void {
  const dir = learningDir(cwd);
  mkdirSync(dir, { recursive: true });
  appendFileSync(eventsPath(cwd), serializeEvent(event), "utf8");
}

export function appendEvents(cwd: string, events: LearningEvent[]): void {
  if (events.length === 0) return;
  const dir = learningDir(cwd);
  mkdirSync(dir, { recursive: true });
  appendFileSync(eventsPath(cwd), events.map(serializeEvent).join(""), "utf8");
}

export function readEvents(cwd: string): {
  events: LearningEvent[];
  malformed: string[];
} {
  const p = eventsPath(cwd);
  if (!existsSync(p)) return { events: [], malformed: [] };
  return parseEventLog(readFileSync(p, "utf8"));
}

export function writeSessionFile(cwd: string, name: string, markdown: string): void {
  const dir = sessionsDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), markdown, "utf8");
}

export function sessionFileFor(iso: string, sessionId: string): string {
  return sessionFileName(iso, sessionId);
}

/**
 * Append a diagnostic line next to the log. Used for conditions that would
 * otherwise be silent — the DEF-001 failure mode.
 */
export function noteProblem(cwd: string, reason: string, detail: string): void {
  try {
    const dir = learningDir(cwd);
    mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${reason} ${detail.replace(/\s+/g, " ").slice(0, 500)}\n`;
    appendFileSync(join(dir, "telemetry-errors.log"), line, "utf8");
  } catch {
    /* never throw from the diagnostics path */
  }
}
