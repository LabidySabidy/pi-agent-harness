/**
 * gardening-command — Pi extension
 *
 * Thin command loader for /gardening. Reads skill-gardening.md (the single
 * source of truth — same file /skill:gardening loads) and injects it as
 * context. Two doors, one room.
 *
 * Safety model: /gardening is code-blocked from starting on a dirty git
 * tree — git is the snapshot and the undo. /skill:gardening (Pi's native
 * door) has a prose guard in the skill file as Step 0 instead.
 *
 * Install at: ~/.pi/agent/extensions/gardening-command/index.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export default function gardeningCommand(pi: ExtensionAPI) {
  console.log("[gardening-command] loaded");

  function isTreeClean(dir: string): { clean: boolean; detail: string } {
    try {
      const out = execSync("git status --porcelain", {
        cwd: dir,
        encoding: "utf8",
        timeout: 5000,
      });
      return { clean: out.trim() === "", detail: out.trim() };
    } catch {
      return { clean: true, detail: "(not a git repo — skipped)" };
    }
  }

  pi.registerCommand("gardening", {
    description:
      "Memory gardening — review, clean, compress, and report on your agent's memory files.",
    handler: async (args: string, ctx: any) => {
      // ── Git guard: block on dirty tree ──────────────────────────
      const HARNESS_ROOT = join(homedir(), ".pi");
      const harness = isTreeClean(HARNESS_ROOT);
      const project = isTreeClean(ctx.cwd);
      if (!harness.clean || !project.clean) {
        let msg = "Gardening blocked: uncommitted changes.\n";
        if (!harness.clean) msg += `~/.pi:\n${harness.detail}\n`;
        if (!project.clean) msg += `${ctx.cwd}:\n${project.detail}\n`;
        msg +=
          "Commit or stash, then re-run. Git is the snapshot and the undo.";
        ctx.ui.notify(msg, "error");
        return;
      }

      // Backup the one gitignored irreplaceable file
      try {
        copyFileSync(
          join(HARNESS_ROOT, "agent", "auth.json"),
          join(HARNESS_ROOT, ".agent", "scratch", "auth.json.bak"),
        );
      } catch {
        /* file may not exist */
      }

      const skillPath = join(
        HARNESS_ROOT,
        "agent",
        "skills",
        "skill-gardening.md",
      );

      let skillContent: string;
      try {
        skillContent = readFileSync(skillPath, "utf8");
      } catch {
        ctx.ui.notify(
          "skill-gardening.md not found at " + skillPath,
          "error",
        );
        return;
      }

      // Inject the skill content as context. This is the same file
      // /skill:gardening loads — single source of truth. Two doors, one room.
      //
      // If Pi's context injection API is available, use it. Otherwise, print
      // the skill header and instruct the agent to follow the file.
      const dryFlag = args?.includes("--dry") ? " --dry" : "";

      if (typeof ctx.injectContext === "function") {
        ctx.injectContext(skillContent);
        ctx.ui.notify(
          "Gardening loaded." + dryFlag + " Send a message to begin.",
          "info",
        );
      } else {
        // Fallback: print header and let the agent know to proceed.
        // The skill file is loaded into the conversation by this message.
        ctx.ui.notify(
          "Gardening loaded." + dryFlag + " Follow skill-gardening.md instructions below.",
          "info",
        );
        // Attempt to pass the content via the input event pipeline
        return { contextInjection: skillContent };
      }
    },
  });
}
