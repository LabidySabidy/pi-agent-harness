/**
 * read-cache — stop re-sending file contents already in context.
 *
 * Hooks tool_result (the same proven seam bash-quiet uses). When a read result
 * arrives for an unchanged file already returned earlier this session at the
 * same (path, offset, limit), its content is replaced with a one-line reference
 * — the model keeps the earlier bytes in context and the re-read costs almost
 * nothing. The disk read still happens every time (that's how changes are
 * detected); the tokens are what's saved.
 *
 * Cache logic: key on (absolute path, offset, limit); content-hash the file.
 * Cleared on compaction (earlier entries may be summarized away) and invalidated
 * per path on any successful edit/write, so a reference is never stale. Images
 * are never cached — they pass through unchanged.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

// Temporary diagnostic — remove once read-cache is confirmed working.
const DEBUG_LOG = join(homedir(), ".pi", "agent", ".read-cache-debug.log");
function dbg(msg: string): void {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

interface CacheEntry {
  hash: string;
}

export default function readCache(pi: ExtensionAPI): void {
  const cache = new Map<string, CacheEntry>();
  dbg("LOADED");

  const invalidatePath = (p: string) => {
    const prefix = p + "::";
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  };

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName === "read" && !event.isError) {
      const input = event.input as {
        path?: string;
        offset?: number;
        limit?: number;
      };
      dbg(`READ input=${JSON.stringify(input)} cwd=${ctx.cwd}`);
      if (typeof input.path !== "string") return;

      // Never cache image results (the model needs the actual image bytes).
      if (event.content.some((c) => c.type === "image")) return;

      const absPath = resolve(input.path, ctx.cwd);

      let hash: string;
      try {
        hash = createHash("sha256").update(readFileSync(absPath)).digest("hex");
      } catch {
        dbg(`  readFileSync failed for ${absPath}`);
        return; // can't hash — leave the read untouched
      }

      const key = `${absPath}::${input.offset ?? 0}::${input.limit ?? ""}`;
      const cached = cache.get(key);
      if (cached && cached.hash === hash) {
        dbg(`  HIT key=${key} size=${cache.size}`);
        return {
          content: [
            {
              type: "text",
              text: `✓ unchanged · ${absPath} — same content as the earlier read of this file, still in context above. No changes detected.`,
            },
          ],
        };
      }
      dbg(`  MISS key=${key} size=${cache.size} (wasCached=${!!cached} hashEq=${cached ? cached.hash === hash : "n/a"})`);
      cache.set(key, { hash });
      return; // first read: keep the original content
    }

    // Invalidate on any successful edit/write — content changed on disk.
    if (
      (event.toolName === "edit" || event.toolName === "write") &&
      !event.isError
    ) {
      const p = (event.input as { path?: string }).path;
      if (typeof p === "string") invalidatePath(resolve(p, ctx.cwd));
    }
  });

  // A compaction summarizes away earlier entries, so a reference could point at
  // content that's no longer visible. Clear the whole cache. (Fork/switch
  // replace the extension instance with a fresh one, and tree summarization
  // does not drop entries from context, so only compaction needs clearing.)
  pi.on("session_compact", () => {
    cache.clear();
    dbg("CLEAR session_compact");
  });
}
