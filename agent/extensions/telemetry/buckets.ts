/**
 * buckets.ts — pure per-layer token bucketing for the telemetry extension.
 *
 * No I/O, no side effects, no pi imports. Takes the messages of one LLM
 * request and estimates (chars/4) how many tokens each layer contributes:
 * user text, skill blocks, read/bash/other tool results, thinking,
 * tool-call arguments, and assistant text.
 *
 * Estimates only — providers report totals, never per-layer splits.
 */

export interface TokenBuckets {
  userText: number;
  skillBlocks: number;
  readResults: number;
  bashResults: number;
  otherToolResults: number;
  thinking: number;
  toolCallArgs: number;
  assistantText: number;
}

export const BUCKET_KEYS = [
  "userText",
  "skillBlocks",
  "readResults",
  "bashResults",
  "otherToolResults",
  "thinking",
  "toolCallArgs",
  "assistantText",
] as const;

/** Matches `<skill name="..." location="...">…</skill>`; captures the body. */
const SKILL_BLOCK_RE = /<skill\s+name="[^"]*"\s+location="[^"]*">([\s\S]*?)<\/skill>/g;

/** chars/4 estimator. Zero chars → zero tokens (empty layers stay empty). */
export function charsToTokens(chars: number): number {
  return chars <= 0 ? 0 : Math.max(1, Math.ceil(chars / 4));
}

function textContentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const block of content as Array<unknown>) {
      if (typeof block === "string") n += block.length;
      else if (
        block &&
        typeof block === "object" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        n += (block as { text: string }).text.length;
      }
    }
    return n;
  }
  return 0;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let out = "";
    for (const block of content as Array<unknown>) {
      if (typeof block === "string") out += block;
      else if (
        block &&
        typeof block === "object" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        out += (block as { text: string }).text;
      }
    }
    return out;
  }
  return "";
}

export function bucketMessages(messages: unknown[]): TokenBuckets {
  const chars: Record<(typeof BUCKET_KEYS)[number], number> = {
    userText: 0,
    skillBlocks: 0,
    readResults: 0,
    bashResults: 0,
    otherToolResults: 0,
    thinking: 0,
    toolCallArgs: 0,
    assistantText: 0,
  };

  for (const raw of messages) {
    const msg = raw as {
      role?: string;
      content?: unknown;
      toolName?: string;
    };
    if (!msg || typeof msg !== "object") continue;

    if (msg.role === "user") {
      const text = textContent(msg.content);
      let skillChars = 0;
      SKILL_BLOCK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SKILL_BLOCK_RE.exec(text)) !== null) {
        skillChars += m[1].trim().length;
      }
      const userChars = text.replace(SKILL_BLOCK_RE, "").trim().length;
      chars.skillBlocks += skillChars;
      chars.userText += userChars;
    } else if (msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<{
          type?: string;
          thinking?: string;
          text?: string;
          name?: string;
          arguments?: unknown;
        }>) {
          if (!block || typeof block !== "object") continue;
          if (block.type === "thinking") {
            chars.thinking += (block.thinking ?? "").length;
          } else if (block.type === "text") {
            chars.assistantText += (block.text ?? "").length;
          } else if (block.type === "toolCall") {
            chars.toolCallArgs +=
              (block.name ?? "").length +
              JSON.stringify(block.arguments ?? {}).length;
          }
        }
      }
    } else if (msg.role === "toolResult") {
      const tokens = textContentChars(msg.content);
      if (msg.toolName === "read") chars.readResults += tokens;
      else if (msg.toolName === "bash") chars.bashResults += tokens;
      else chars.otherToolResults += tokens;
    }
  }

  const out = {} as TokenBuckets;
  for (const k of BUCKET_KEYS) {
    out[k] = charsToTokens(chars[k]);
  }
  return out;
}
