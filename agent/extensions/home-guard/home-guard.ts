/**
 * home-guard — skip memory writes when the session's cwd is the user's home directory.
 *
 * WHY THIS EXISTS, with the failure it prevents:
 *
 *   Pi writes its memory files relative to `ctx.cwd`. Start Pi in the home directory — which happens
 *   by accident, by opening a terminal and typing `pi` — and `session-summary`, `extract-patterns`
 *   and `telemetry` all treat `C:\Users\<me>\` as a project. The result on this machine was a
 *   `PROGRESS.md`, a `VALIDATION-SWEEP-*.md` and a whole `.agent/` directory sitting in the home
 *   root, none of which belongs to any project, and none of which the owner would ever think to look
 *   for. Seven such sessions were recorded.
 *
 *   A `PROGRESS.md` in the home directory is not a project's memory; it is a stray file that makes
 *   the harness look careless the first time someone opens their home folder.
 *
 * WHAT IT DOES NOT DO: it does not block the session, and it does not warn. It returns a boolean and
 * the caller decides. A guard that refuses to start, or that prints on every turn, costs more than
 * the problem.
 *
 * PLACEMENT (GL-027): this is a module directory, NOT an extension. Pi discovers extensions in
 * `agent/extensions/` as (1) direct `*.ts` files, (2) a subdirectory with `index.ts`/`index.js`, or
 * (3) a subdirectory with a `package.json` `pi` manifest — and, in the loader's own words, "No
 * recursion beyond one level". A directory with a plain helper module and no entry point is therefore
 * inert, which is exactly what is wanted and why this file has no `export default`.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Is `cwd` the user's home directory (or the same directory reached by a different path)?
 *
 * Deliberately only the home directory itself, not its descendants: `~/projects/thing` is a real
 * project and must still get its memory files. The failure being prevented is Pi started *at* home,
 * not Pi started somewhere under it.
 *
 * Resolution is normalised on both sides so `C:\Users\me`, `C:/Users/me` and a trailing separator all
 * compare equal — Windows path encoding differs per shell layer (GL-001), and a guard that
 * silently stops matching is worse than no guard.
 */
export function isHomeDirectory(cwd: string | undefined | null): boolean {
  if (!cwd) return false;
  const normalize = (p: string): string => {
    const resolved = resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  try {
    return normalize(cwd) === normalize(homedir());
  } catch {
    // A malformed path must not take down a session. Fail open: writing a stray file is a smaller
    // harm than breaking the turn.
    return false;
  }
}

/**
 * Should this session skip its project-scoped memory writes?
 *
 * Named for intent rather than mechanism, so call sites read as policy:
 *   `if (skipProjectMemory(ctx.cwd)) return;`
 *
 * Escape hatch: `PI_ALLOW_HOME_MEMORY=1` restores the old behaviour for anyone who deliberately
 * wants a PROGRESS.md in their home directory.
 */
export function skipProjectMemory(cwd: string | undefined | null): boolean {
  if (process.env.PI_ALLOW_HOME_MEMORY === "1") return false;
  return isHomeDirectory(cwd);
}
