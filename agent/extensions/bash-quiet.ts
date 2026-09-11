/**
 * bash-quiet — collapse successful verification-command output to one line.
 *
 * Hooks tool_result and acts only on successful (isError=false) bash results
 * whose command matches a verification pattern (build/test/lint/typecheck).
 * Writes the full output to a temp file owned by this extension and replaces
 * the model-visible content with a one-line summary. Failures pass through
 * untouched — tool_result exposes no exit code, so !isError is the success
 * signal (non-zero exit, timeout and abort all surface as isError=true).
 *
 * This is currently the only tool_result handler, so there are no chaining
 * concerns. A throwing handler is logged and skipped by pi, and the file
 * write is wrapped anyway so a failure degrades to the original output.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// --- Tuning knob: which commands count as "verification" -----------------
// Conservative on purpose: a false positive swallows output the model needs.
// Patterns anchor at start-of-string or after a shell separator (space ; & |)
// so "cat gradle-output.txt" does not match. Add/edit regexes here only.
const VERIFY_PATTERNS: RegExp[] = [
  /(^|[\s;&|])(\.\/)?gradlew?(\s|$)/, // ./gradlew build, gradle test
  /(^|[\s;&|])(\.\/)?mvnw?(\s|$)/, // mvn test/package/checkstyle, ./mvnw
  /(^|[\s;&|])tsc(\s|$)/, // tsc, npx tsc --noEmit
  /(^|[\s;&|])(npm|pnpm|yarn|bun)(\s+run)?\s+(build|test|lint|typecheck|tsc|check)(\s|$)/,
  /(^|[\s;&|])(cargo|go|make|ninja)\s+(build|test|lint|check)(\s|$)/,
  /(^|[\s;&|])(pytest|ruff|mypy|flake8|eslint|vitest|jest|checkstyle)(\s|$)/,
];

// Failure signals in output text. If any matches, do NOT collapse — the shell
// may still have exited 0 (e.g. `cmd; echo "EXIT: $?"` swallows the real exit
// code). Erring toward not-collapsing is safe: worst case we lose the collapse,
// never report a real failure as passed.
const FAILURE_HINTS: RegExp[] = [
  /\bEXIT:\s*[1-9]\d*\b/, // the model's own exit-code echo idiom
  /\berrors?\b/i, // "error TS2365", "Error:", "errors"
  /\bfail(?:ed|ure)?\b/i, // "failed", "failure", "FAILED"
  /\baborted\b/i,
  /\btimed out\b/i,
];

export default function bashQuiet(pi: ExtensionAPI): void {
  pi.on("tool_result", (event, _ctx) => {
    if (event.toolName !== "bash" || event.isError) return;

    const raw = (event.input as { command?: unknown }).command;
    const command = typeof raw === "string" ? raw : "";
    if (!command || !VERIFY_PATTERNS.some((re) => re.test(command))) return;

    try {
      // Prefer pi's full-output temp file when the result was truncated;
      // otherwise the content text is the full output.
      const details = event.details as { fullOutputPath?: string } | undefined;
      const fullText =
        details?.fullOutputPath && existsSync(details.fullOutputPath)
          ? readFileSync(details.fullOutputPath, "utf8")
          : (event.content ?? [])
              .map((c) => (c.type === "text" ? c.text : ""))
              .join("");

      if (FAILURE_HINTS.some((re) => re.test(fullText))) return; // leave failures untouched

      const lines = fullText
        ? fullText.replace(/\n$/, "").split("\n").length
        : 0;
      const path = join(
        tmpdir(),
        `pi-bash-quiet-${Date.now()}-${randomBytes(4).toString("hex")}.log`,
      );
      writeFileSync(path, fullText);

      return {
        content: [
          { type: "text", text: `✓ passed · ${lines} lines · full: ${path}` },
        ],
      };
    } catch {
      return; // degrade to original output
    }
  });
}
