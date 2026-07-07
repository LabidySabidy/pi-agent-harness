<!-- When a lesson shapes your approach, cite its ID in your reply, e.g. "per GL-000". -->

# Cross-Project Lessons

> Patterns that apply across projects. Loaded at session start alongside the project-specific LESSONS.md.
> Promote items here via `/skill:gardening`.

## Danger zones

- GL-001 [anchor] Windows path encoding — Backslashes in file paths break in multiple contexts: JSON strings need `\\`, `file://` URLs need forward slashes, grep patterns need escaping. Always test path construction on Windows before assuming it's portable.
- GL-002 `gh` CLI not installed — Projects with `branch_tracking: true` depend on `gh` for PR creation. The branch-hygiene skill detects this at Phase B step 0, but projects without branch tracking won't catch it until the first PR is needed. Check `gh auth status` early.

## Gotchas

- GL-003 Pi `edit` tool whitespace sensitivity — The `oldText` must match exactly including line endings. Windows CRLF vs LF differences cause silent failures. When an edit fails to find text, check line endings first.
- GL-004 `git branch --merged` includes current branch — The `*` prefix on the current branch line is not a grep-friendly marker. Parse output by dropping lines starting with `*` and the base branch name, rather than grepping.

## Decisions made

- GL-005 Skills over monolithic prompts — Pi harness uses composable skills with `/skill:name` invocation rather than one large system prompt. Each skill owns one workflow. Skills reference each other explicitly (e.g., plan-then-implement → grill, plan-then-implement → branch).
- GL-006 AGENTS.md frontmatter over new config files — Project-level configuration (e.g., `branch_tracking: true`) lives in project AGENTS.md as YAML frontmatter. No `.agent/config` file. This keeps the convention count low and the config visible.

## Anti-patterns

- GL-007 Don't jam new features into existing skills — plan-then-implement should not absorb branch creation, approach exploration, or review workflows. Each concern gets its own skill. Skills reference each other at integration points (one-line invocations), not by merging text.
- GL-008 ~~Don't create a new config file when AGENTS.md frontmatter works — Same pattern as above.~~ <!-- merged-into GL-006 -->
- GL-009 Don't write verification claims without evidence — "Tests pass" is not verification; the test output in the message is. "Grepped for keywords" is not verification; the matched line with line number is. This applies across every project, every session.

## Always do

- GL-010 Branch before code — When `branch_tracking: true`, the first non-trivial Write/Edit on main must be preceded by `/skill:branch` Phase A. Session-start protocol item 3 checks this.
- GL-011 Verify before claiming — Per AGENTS.md verification-before-claim rule: never claim "done," "fixed," or "passing" without fresh verification output in the current message. The `Verified:` line in every recap must cite specific evidence.
