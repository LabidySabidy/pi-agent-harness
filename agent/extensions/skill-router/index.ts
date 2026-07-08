/**
 * Skill Router — keyword-based skill auto-selection.
 *
 * Scans every user message against skill trigger phrases extracted from skill
 * file descriptions. When a match is found, injects a routing hint the model
 * sees but is not displayed in the chat UI. Deterministic, local, zero-cost.
 *
 * Replaces the deleted classifier-router (OpenRouter-based, ~$0.01/msg).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────────

interface SkillRoute {
  name: string;
  phrases: string[];
}

// ── Word utils ───────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been",
  "to", "for", "with", "from", "and", "or", "but", "not", "no",
  "this", "that", "it", "its", "i", "we", "you", "they", "me",
  "asked", "time", "when", "only", "has", "have", "had", "can",
  "will", "would", "could", "should", "really", "very", "just",
  "then", "than", "also", "too", "some", "any", "all",
  "if", "of", "in", "on", "at", "by", "as", "so", "do", "does",
  "need", "want", "like", "get", "got", "make", "let",
]);

function stem(word: string): string {
  // Simple suffix-stripping — enough for trigger matching, not general NLP
  return word
    .replace(/(?:ing|ed|es|s)$/, "")
    .replace(/(?:tion|ment|ness|able|ible)$/, "")
    .replace(/e$/, ""); // strip trailing e after other suffixes removed
}

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;:.!?"'—\-()\[\]{}]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map(stem);
}

// ── Phrase extraction ────────────────────────────────────────────────────

function extractPhrases(description: string, extraPhrases: string[]): string[] {
  const phrases: string[] = [];
  const lower = description.toLowerCase();

  // Extract trigger patterns from description
  // "Use when/for ..." and "Only for ..." patterns
  const useRe = /(?:use|only)\s+(?:when|for)\s+(.+?)(?:\.(?:\s|$)|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = useRe.exec(lower)) !== null) {
    const clause = match[1].trim();
    const parts = clause.split(/\s*,\s*|\s+or\s+/);
    for (const part of parts) {
      const cleaned = part
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/^(?:or|a|an)\s+/i, "");
      if (cleaned.length >= 3) phrases.push(cleaned);
    }
  }

  // Also extract the part after "—" or " - " as it often has trigger phrases
  const dashIdx = lower.search(/\s[—\-]\s/);
  if (dashIdx !== -1) {
    const afterDash = lower.slice(dashIdx + 3).split(/\.\s+/)[0];
    if (!useRe.test(afterDash)) {
      const parts = afterDash.split(/\s*,\s*|\s+or\s+/);
      for (const part of parts) {
        const cleaned = part.trim().replace(/^["']|["']$/g, "").replace(/^(?:a|an)\s+/i, "");
        if (cleaned.length >= 3 && !cleaned.startsWith("use ") && !cleaned.startsWith("only ")) {
          phrases.push(cleaned);
        }
      }
      useRe.lastIndex = 0;
    }
  }

  // Add hyphen-list trigger phrases from frontmatter
  for (const p of extraPhrases) {
    const cleaned = p.toLowerCase().trim().replace(/^["']|["']$/g, "");
    if (cleaned.length >= 3) phrases.push(cleaned);
  }

  return phrases;
}

function parseSkillFile(filePath: string): SkillRoute | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const parts = content.split(/^---\s*$/m);
    if (parts.length < 2) return null;

    const frontmatter = parts[1];
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (!descMatch) return null;

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    if (!nameMatch) return null;

    // Extract hyphen-list trigger phrases (double-quoted, single-quoted, or bare)
    const extraPhrases: string[] = [];
    const listRe = /^\s*-\s*(?:"([^"]+)"|'([^']+)'|(.+))$/gm;
    let lm: RegExpExecArray | null;
    while ((lm = listRe.exec(frontmatter)) !== null) {
      extraPhrases.push(lm[1] || lm[2] || lm[3]);
    }

    const name = nameMatch[1].trim();
    const desc = descMatch[1].trim();

    // Skip deprecated stubs
    if (desc.toLowerCase().includes("deprecated")) return null;

    const phrases = extractPhrases(desc, extraPhrases);
    if (phrases.length === 0) return null;

    return { name, phrases };
  } catch {
    return null;
  }
}

// Hardcoded synonyms for words that strongly indicate a skill but don't
// appear in its description. A single synonym match routes to the skill.
const SKILL_SYNONYMS: Record<string, string[]> = {
  "investigate-bug": ["bug", "bugfix", "defect", "fix", "regression", "error", "crash", "broken", "stopped working"],
  "plan-then-implement": ["coding", "write code", "development"],
  "grill": ["review", "audit", "critique"],
  "gardening": ["organize", "tidy up", "cleanup"],
  "scaffold": ["bootstrap", "kickstart", "start a project", "init"],
  "branch-hygiene": ["branching", "merge request", "pull request"],
  "spike": ["explore", "research", "investigate", "play around"],
};

function loadRoutes(): SkillRoute[] {
  const skillsDir = join(homedir(), ".pi", "agent", "skills");
  const routes: SkillRoute[] = [];

  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return routes;
  }

  for (const entry of entries) {
    if (!entry.startsWith("skill-") || !entry.endsWith(".md")) continue;
    const route = parseSkillFile(join(skillsDir, entry));
    if (route) {
      // Inject hardcoded synonym phrases
      const synonyms = SKILL_SYNONYMS[route.name];
      if (synonyms) route.phrases.push(...synonyms);
      routes.push(route);
    }
  }

  return routes;
}

// ── Matching ─────────────────────────────────────────────────────────────

function matchRoute(text: string, routes: SkillRoute[]): string | null {
  const lower = text.toLowerCase();

  // Skip if user already typed a slash command
  if (/^\s*\/[a-z]/.test(lower)) return null;

  const userWords = new Set(contentWords(lower));

  let bestSkill: string | null = null;
  let bestScore = 0;
  let bestLength = 0;

  for (const route of routes) {
    let score = 0;
    let matchLength = 0;

    for (const phrase of route.phrases) {
      // Exact substring match: strong signal (3x weight)
      if (lower.includes(phrase)) {
        score += 3;
        matchLength += phrase.length;
        continue;
      }

      // Word overlap: score based on content word intersection
      const phraseWords = contentWords(phrase);
      if (phraseWords.length === 0) continue;

      let wordHits = 0;
      for (const w of phraseWords) {
        if (userWords.has(w)) wordHits++;
      }

      // Require majority of phrase content words to match
      if (wordHits >= Math.ceil(phraseWords.length * 0.6)) {
        score += 1;
        matchLength += phrase.length;
      }
    }

    if (score > 0 && (score > bestScore || (score === bestScore && matchLength > bestLength))) {
      bestSkill = route.name;
      bestScore = score;
      bestLength = matchLength;
    }
  }

  return bestSkill;
}

// ── Extension ────────────────────────────────────────────────────────────

export default function skillRouter(pi: ExtensionAPI) {
  const routes = loadRoutes();
  let pendingRoute: string | null = null;

  pi.on("input", async (event, ctx) => {
    // Skip if user typed a slash command or explicit skill invocation
    if (/^\s*\/[a-z]/.test(event.text)) return;

    const route = matchRoute(event.text, routes);
    pendingRoute = route;

    if (route) {
      ctx.ui.notify(`skill-router → ${route}`, "info");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!pendingRoute) return;

    const skill = pendingRoute;
    pendingRoute = null;

    // Inject into system prompt — guaranteed model visibility
    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n[SKILL ROUTING] The user's request matches skill: ${skill}. Invoke /skill:${skill} now.`,
    };
  });
}
