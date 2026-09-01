/**
 * lobdell-timer.ts
 *
 * Enforces the "Cognitive Sprint Gate": after 30 minutes of active study,
 * append a physical boundary cue to the outgoing assistant message so the user
 * stops and rests (hippocampal consolidation). Resets on break acknowledgment.
 *
 * Hooks: session_start (fresh segment), input (break-resume reset),
 * message_end (append the gate to the assistant message — the only hook that
 * can return a replacement message).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SPRINT_GATE = `

---
⚠️ **[COGNITIVE SPRINT GATE]**
You have been actively studying for **30 minutes**. Human study efficiency collapses beyond this threshold because your hippocampus requires rest to consolidate transitory memory into permanent, structured long-term schemas.

**Action Required:** Turn off your study lamp, step away from your desk, make a tea, or relax for **5 minutes** before continuing.
---
`;

// anchored at start so incidental uses of "back"/"resume" mid-sentence don't reset
const BREAK_RESUME_RE =
  /^(back|break done|break over|resume|returning|i'?m back|im back|done with break)\b/i;

// file-scoped, survives across turns for the lifetime of the Node process
let sessionStartTime: number = Date.now();

function isBreakResume(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const t = text.trim().replace(/^\/+/, "").toLowerCase();
  return BREAK_RESUME_RE.test(t);
}

function appendText(content: unknown, text: string): unknown {
  if (typeof content === "string") return content + text;
  if (Array.isArray(content)) {
    const arr = content as any[];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] && arr[i].type === "text" && typeof arr[i].text === "string") {
        return [
          ...arr.slice(0, i),
          { ...arr[i], text: arr[i].text + text },
          ...arr.slice(i + 1),
        ];
      }
    }
    return [...arr, { type: "text", text }];
  }
  return content;
}

export default function (pi: ExtensionAPI) {
  // Workspace-divergent bypass: keep the app-development workspace (pi-web)
  // completely free of study-fatigue guardrails.
  const cwd = process.cwd().replace(/\\/g, "/");
  if (cwd.includes("pi-web")) {
    return; // silent bypass — register no hooks
  }

  // fresh 30-minute segment for every session lifecycle (startup/new/resume/reload)
  pi.on("session_start", () => {
    sessionStartTime = Date.now();
  });

  // self-healing reset: user acknowledges the break
  pi.on("input", async (event: any) => {
    if (isBreakResume(event?.text)) {
      sessionStartTime = Date.now();
    }
  });

  // enforce the gate on the outgoing assistant message
  pi.on("message_end", async (event: any) => {
    try {
      const message = event?.message;
      if (!message || message.role !== "assistant") return;

      const elapsedMinutes = (Date.now() - sessionStartTime) / 60000;
      if (elapsedMinutes < 30) return;

      return {
        message: { ...message, content: appendText(message.content, SPRINT_GATE) },
      };
    } catch {
      /* never crash the session */
    }
  });
}
