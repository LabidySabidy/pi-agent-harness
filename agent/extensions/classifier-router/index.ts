/**
 * classifier-router — Pi extension
 *
 * Routes user messages to skills via a small DeepSeek V4 Flash classifier call.
 * Replaces brittle keyword-based routing with intent classification.
 *
 * Install at: ~/.pi/agent/extensions/classifier-router/index.ts
 *
 * IMPORTANT: Pi's exact extension API is documented at
 *   https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
 * If any of the API calls below don't match (event names, registration methods,
 * model invocation), adjust to match the current docs. The CLASSIFICATION LOGIC
 * is the load-bearing part — the API surface is approximate.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ClassifierResult {
  skill: string | null;
  confidence: number;
  reasoning: string;
}

const AVAILABLE_SKILLS = [
  {
    name: "grill",
    description:
      "Adversarial design interrogation before non-trivial implementation",
  },
  {
    name: "scaffold",
    description:
      "New project bootstrap with discovery, GitHub repo, and live Vercel deploy",
  },
  {
    name: "plan-then-implement",
    description: "Read-then-plan-then-implement pattern with TDD",
  },
  {
    name: "investigate-bug",
    description: "Structured defect investigation, root cause, TDD fix",
  },
  {
    name: "branch-hygiene",
    description:
      "Feature-branch start, PR creation, and branch cleanup",
  },
  {
    name: "promote-lessons",
    description:
      "Review pending lesson candidates and promote accepted ones into LESSONS.md",
  },
  {
    name: "spike",
    description:
      "Throwaway prototype to validate the riskiest technical assumption",
  },
];

const CLASSIFIER_MODEL = "deepseek/deepseek-chat";

const AUTO_LOAD_THRESHOLD = 0.7;
const SUGGEST_THRESHOLD = 0.4;

const SYSTEM_PROMPT = `
You classify user messages to a coding agent into one of a small set of skills.

Available skills:
${AVAILABLE_SKILLS.map(
  (s) => `- ${s.name}: ${s.description}`
).join("\n")}

Output JSON only, no commentary, in this exact shape:

{
  "skill": "<skill-name-or-null>",
  "confidence": <0.0-1.0>,
  "reasoning": "<one short sentence>"
}

Rules:
- Return null if the message is conversational, a clarification, or doesn't fit any skill.
- Confidence reflects how sure you are this skill is the right match.
- "investigate-bug" wins over "plan-then-implement" when the message is about something failing.
- "grill" loads when user says "grill me", "poke holes", "red team", or describes a non-trivial plan to interrogate.
- "scaffold" is ONLY for genuinely new projects (not features in existing projects). Strong signals: the user is naming a new app, describing what it does, or saying "build a new app". Weak signals to IGNORE: talking about process, approving changes ("i dig it", "looks good", "yes"), discussing skills or configuration, mentioning "new projects" in a meta context about how things work.
- Short questions, clarifications, status checks, approvals ("yes", "sounds good", "i dig it"), and meta-discussion about skills/process should return null.
`;

export default function classifierRouter(pi: ExtensionAPI) {
  console.log("[classifier-router] loaded");

  // Register command
  pi.registerCommand("router-test", {
    description: "Test the classifier routing",
    handler: async (args: string, ctx: any) => {
      if (!args || !args.trim()) {
        ctx.ui.notify("Usage: /router-test <message>", "warning");
        return;
      }

      const result = await classify(args);

      if (result.reasoning === "missing OPENROUTER_API_KEY") {
        ctx.ui.notify("Classifier: OPENROUTER_API_KEY not set", "error");
        return;
      }

      const pct = (result.confidence * 100).toFixed(0);
      ctx.ui.notify(
        `Skill: ${result.skill || "none"} (${pct}%) — ${result.reasoning}`,
        result.skill ? "info" : "warning"
      );
    },
  });

  // Hook into user input — classify and route to skills
  pi.on("input", async (event: any, ctx: any) => {
    try {
      const message = event?.text || "";

      if (!message || message.trim().length < 10) {
        return { action: "continue" };
      }

      // Ignore slash commands
      if (message.startsWith("/")) {
        return { action: "continue" };
      }

      const result = await classify(message);

      console.log("[classifier-router]", result);

      if (
        result.skill &&
        result.confidence >= AUTO_LOAD_THRESHOLD
      ) {
        ctx.ui.notify(
          `Auto-loading skill: ${result.skill}`,
          "info"
        );

        // Transform input to load the skill automatically
        return {
          action: "transform",
          text: `/skill:${result.skill} ${message}`,
        };
      } else if (
        result.skill &&
        result.confidence >= SUGGEST_THRESHOLD
      ) {
        const pct = (result.confidence * 100).toFixed(0);
        ctx.ui.notify(
          `Suggested skill: ${result.skill} (${pct}%)`,
          "info"
        );
      }

      return { action: "continue" };
    } catch (err) {
      console.error(
        "[classifier-router] runtime error:",
        err
      );
      return { action: "continue" };
    }
  });
}

async function classify(
  message: string
): Promise<ClassifierResult> {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return {
        skill: null,
        confidence: 0,
        reasoning: "missing OPENROUTER_API_KEY",
      };
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODEL,
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: message,
            },
          ],
          temperature: 0.1,
          max_tokens: 200,
        }),
      }
    );

    const data = await response.json();

    const text =
      data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      return {
        skill: null,
        confidence: 0,
        reasoning: "empty response",
      };
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return {
        skill: null,
        confidence: 0,
        reasoning: "no JSON returned",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      skill:
        typeof parsed.skill === "string"
          ? parsed.skill
          : null,
      confidence:
        typeof parsed.confidence === "number"
          ? parsed.confidence
          : 0,
      reasoning:
        typeof parsed.reasoning === "string"
          ? parsed.reasoning
          : "unknown",
    };
  } catch (err) {
    console.error(
      "[classifier-router] classify failed:",
      err
    );

    return {
      skill: null,
      confidence: 0,
      reasoning: "classifier exception",
    };
  }
}