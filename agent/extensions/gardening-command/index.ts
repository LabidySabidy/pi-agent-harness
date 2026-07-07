/**
 * gardening-command — Pi extension
 *
 * Thin command loader for /gardening. Reads skill-gardening.md (the single
 * source of truth — same file /skill:gardening loads) and injects it as
 * context. Two doors, one room.
 *
 * Install at: ~/.pi/agent/extensions/gardening-command/index.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export default function gardeningCommand(pi: ExtensionAPI) {
  console.log("[gardening-command] loaded");

  pi.registerCommand("gardening", {
    description:
      "Memory gardening — review, clean, compress, and report on your agent's memory files.",
    handler: async (args: string, ctx: any) => {
      const skillPath = join(
        homedir(),
        ".pi",
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
