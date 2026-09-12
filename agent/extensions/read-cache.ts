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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

interface CacheEntry {
  hash: string;
}

export default function readCache(pi: ExtensionAPI): void {
  const cache = new Map<string, CacheEntry>();

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
      if (typeof input.path !== "string") return;

      // Never cache image results (the model needs the actual image bytes).
      if (event.content.some((c) => c.type === "image")) return;

      const absPath = resolve(ctx.cwd, input.path);

      let hash: string;
      try {
        hash = createHash("sha256").update(readFileSync(absPath)).digest("hex");
      } catch {
        return; // can't hash — leave the read untouched
      }

      const key = `${absPath}::${input.offset ?? 0}::${input.limit ?? ""}`;
      const cached = cache.get(key);
      if (cached && cached.hash === hash) {
        return {
          content: [
            {
              type: "text",
              text: `✓ unchanged · ${absPath} — same content as the earlier read of this file, still in context above. No changes detected.`,
            },
          ],
        };
      }

      cache.set(key, { hash });
      return; // first read: keep the original content
    }

    // Invalidate on any successful edit/write — content changed on disk.
    if (
      (event.toolName === "edit" || event.toolName === "write") &&
      !event.isError
    ) {
      const p = (event.input as { path?: string }).path;
      if (typeof p === "string") invalidatePath(resolve(ctx.cwd, p));
    }
  });

  // A compaction summarizes away earlier entries, so a reference could point at
  // content that's no longer visible. Clear the whole cache. (Fork/switch
  // replace the extension instance with a fresh one, and tree summarization
  // does not drop entries from context, so only compaction needs clearing.)
  pi.on("session_compact", () => cache.clear());
}
