/**
 * read-cache — stop re-sending file contents already in context.
 *
 * Overrides the built-in `read` tool. Among extensions the first registration
 * of a name wins SILENTLY — if a future extension also registers `read`, this
 * conflict will produce no warning. Keep this in mind before adding tools.
 *
 * The definition is built by spreading createReadToolDefinition(), so the
 * built-in's schema, prompt snippet, guidelines, and renderers are preserved;
 * only `execute` is replaced. The disk read still happens every time (that's
 * how changes are detected); the tokens are what's saved.
 *
 * Cache logic: key on (absolute path, offset, limit); content-hash the file.
 * A hit returns a one-line reference instead of the bytes. The cache is cleared
 * on compaction (earlier entries may be summarized away) and invalidated per
 * path on any successful edit/write, so a reference is never stale. Images are
 * never cached — they pass through unchanged.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
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

  // Invalidate on any successful edit/write — content changed on disk.
  pi.on("tool_result", (event, ctx) => {
    if (
      (event.toolName === "edit" || event.toolName === "write") &&
      !event.isError
    ) {
      const p = (event.input as { path?: string }).path;
      if (typeof p === "string") invalidatePath(resolve(p, ctx.cwd));
    }
  });

  // A compaction summarizes away earlier entries, so a reference could point at
  // content that's no longer visible. Fork/switch/tree change the branch too.
  // Clear the whole cache rather than risk a stale reference.
  pi.on("session_compact", () => cache.clear());
  pi.on("session_before_tree", () => cache.clear());
  pi.on("session_before_fork", () => cache.clear());
  pi.on("session_before_switch", () => cache.clear());

  pi.registerTool({
    ...createReadToolDefinition(process.cwd()), // schema/snippet/guidelines/renderers
    execute: async (id, params, signal, onUpdate, ctx) => {
      const absPath = resolve(params.path, ctx.cwd);

      // Always perform the real read (built-in behavior, correct cwd).
      const base = createReadToolDefinition(ctx.cwd);
      const result = await base.execute(id, params, signal, onUpdate, ctx);

      // Never cache image results.
      if (result.content.some((c) => c.type === "image")) return result;

      let hash: string;
      try {
        hash = createHash("sha256").update(readFileSync(absPath)).digest("hex");
      } catch {
        return result; // can't hash — return the read as-is
      }

      const key = `${absPath}::${params.offset ?? 0}::${params.limit ?? ""}`;
      const cached = cache.get(key);
      if (cached && cached.hash === hash) {
        return {
          content: [
            {
              type: "text",
              text: `✓ unchanged · ${absPath} — same content as the earlier read of this file, still in context above. No changes detected.`,
            },
          ],
          details: undefined,
        };
      }

      cache.set(key, { hash });
      return result;
    },
  });
}
