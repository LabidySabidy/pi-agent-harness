/**
 * bash-quiet — shrink successful bash output to a summary + temp file.
 *
 * Two tiers:
 *   1. Verification commands (build/test/lint/typecheck) collapse to a one-line
 *      "✓ passed" summary — the model only needs the pass/fail bit (2a).
 *   2. Any other successful output over COLLAPSE_MIN_LINES collapses to a
 *      head/tail window + temp path — the model keeps context without the full
 *      dump. Session history has ~922k tokens of this (2b).
 *
 * Failures pass through untouched. tool_result exposes no exit code, so
 * !isError is the success signal; but the model often appends `; echo "EXIT: $?"`
 * which makes the shell exit 0 even on failure, so the output text is scanned
 * for failure signals. That scan is tiered: verification commands trust
 * "error"/"failed" text (2a), general output only trusts EXIT:N>0 / aborted /
 * timeout (2b) — there, "error" is usually just data (e.g. package names).
 * A throwing handler is logged and skipped by pi, and the file write is wrapped,
 * so a bug degrades to the original output rather than breaking the session.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// --- Tuning knobs (edit here) ---------------------------------------------

// Verification commands: collapse to a one-line "✓ passed" (2a).
// Conservative on purpose: a false positive swallows output the model needs.
// Patterns anchor at start-of-string or after a shell separator (space ; & |)
// so "cat gradle-output.txt" does not match.
export const VERIFY_PATTERNS: RegExp[] = [
  /(^|[\s;&|])(\.\/)?gradlew?(\s|$)/, // ./gradlew build, gradle test
  /(^|[\s;&|])(\.\/)?mvnw?(\s|$)/, // mvn test/package/checkstyle, ./mvnw
  /(^|[\s;&|])tsc(\s|$)/, // tsc, npx tsc --noEmit
  /(^|[\s;&|])(npm|pnpm|yarn|bun)(\s+run)?\s+(build|test|lint|typecheck|tsc|check)(\s|$)/,
  /(^|[\s;&|])(cargo|go|make|ninja)\s+(build|test|lint|check)(\s|$)/,
  /(^|[\s;&|])(pytest|ruff|mypy|flake8|eslint|vitest|jest|checkstyle)(\s|$)/,
  /(^|[\s;&|])node\b[^|;&]*--test(?:\s|$)/, // node --test, node --import tsx --test
];

// Any other successful output over this many lines collapses to a head/tail
// window (2b). Below it, leave output alone — savings aren't worth the risk.
const COLLAPSE_MIN_LINES = 200;
const WINDOW_HEAD_LINES = 25;
const WINDOW_TAIL_LINES = 25;

// Failure signals in output text. If any matches, do NOT collapse — the shell
// may still have exited 0 (e.g. `cmd; echo "EXIT: $?"` swallows the real exit
// code). Erring toward not-collapsing is safe: worst case we lose the collapse,
// never report a real failure as passed.
//
// Two tiers: verification output treats "error"/"failed" as genuine failure;
// general output does not, because those words are often just data (package
// names like es-errors, log lines). General only trusts unambiguous signals.
export const VERIFY_FAILURE_HINTS: RegExp[] = [
  /\bEXIT:\s*[1-9]\d*\b/, // the model's own exit-code echo idiom
  // "error"/"fail" families, but NOT zero counts — passing test summaries print
  // "fail 0" / "0 errors", and matching those blocked the collapse.
  /(?<!\b0\s)\berrors?\b(?!\s*[:=]?\s*0\b)/i, // "error TS2365", "3 errors"
  /(?<!\b0\s)\bfail(?:ed|ure|ing)?s?\b(?!\s*[:=]?\s*0\b)/i, // "failed", "2 failures"
  /\baborted\b/i,
  /\btimed out\b/i,
];
export const GENERAL_FAILURE_HINTS: RegExp[] = [
  /\bEXIT:\s*[1-9]\d*\b/, // the model's own exit-code echo idiom
  /\baborted\b/i,
  /\btimed out\b/i,
];

function fullOutput(event: {
  details?: unknown;
  content?: Array<{ type: string; text?: string }>;
}): string {
  const p = (event.details as { fullOutputPath?: string } | undefined)
    ?.fullOutputPath;
  if (p && existsSync(p)) return readFileSync(p, "utf8");
  return (event.content ?? [])
    .map((c) => (c.type === "text" ? c.text ?? "" : ""))
    .join("");
}

function writeTemp(text: string): string {
  const path = join(
    tmpdir(),
    `pi-bash-quiet-${Date.now()}-${randomBytes(4).toString("hex")}.log`,
  );
  writeFileSync(path, text);
  return path;
}

function countLines(text: string): number {
  return text ? text.replace(/\n$/, "").split("\n").length : 0;
}

function headTail(text: string): {
  head: string;
  tail: string;
  omitted: number;
} {
  const all = text.split("\n");
  const head = all.slice(0, WINDOW_HEAD_LINES).join("\n");
  const tail = all.slice(-WINDOW_TAIL_LINES).join("\n");
  const omitted = Math.max(
    0,
    all.length - WINDOW_HEAD_LINES - WINDOW_TAIL_LINES,
  );
  return { head, tail, omitted };
}

export default function bashQuiet(pi: ExtensionAPI): void {
  pi.on("tool_result", (event, _ctx) => {
    if (event.toolName !== "bash" || event.isError) return;
    const raw = (event.input as { command?: unknown }).command;
    const command = typeof raw === "string" ? raw : "";
    if (!command) return;

    try {
      const full = fullOutput(event);
      const isVerify = VERIFY_PATTERNS.some((re) => re.test(command));
      const hints = isVerify ? VERIFY_FAILURE_HINTS : GENERAL_FAILURE_HINTS;
      if (hints.some((re) => re.test(full))) return; // leave failures untouched
      const lines = countLines(full);

      if (isVerify) {
        const path = writeTemp(full);
        return {
          content: [
            { type: "text", text: `✓ passed · ${lines} lines · full: ${path}` },
          ],
        };
      }

      if (lines <= COLLAPSE_MIN_LINES) return;
      const path = writeTemp(full);
      const { head, tail, omitted } = headTail(full);
      return {
        content: [
          {
            type: "text",
            text: `✓ ${lines} lines · full: ${path}\n[head]\n${head}\n[${omitted} lines omitted]\n[tail]\n${tail}`,
          },
        ],
      };
    } catch {
      return; // degrade to original output
    }
  });
}
