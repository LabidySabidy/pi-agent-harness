---
name: promote-lessons
description: Review pending lesson candidates and promote accepted ones into LESSONS.md — low-friction, one-at-a-time review
triggers:
  - "promote lessons"
  - "review pending lessons"
  - "promote to lessons"
  - "clean up pending lessons"
  - "lessons review"
---

# Skill: Promote Lessons

**DEPRECATED — use /skill:gardening (Pass 1: Intake) instead.**

Gardening replaces promote-lessons with a full memory management workflow:
intake, merge, demote, compress, progress horizon, asset sweeps, break-in
review, and reporting. All gated, all with --dry support.

If you arrived here via the classifier-router: type `/skill:gardening` to
begin, or just say "garden" and the router will route you there.

---

_Original skill body preserved below for reference. This skill is no longer
maintained — updates happen in skill-gardening.md._

---

## Hard rules

1. **Show context.** For each candidate, show the category + text + context excerpt
   (if available from the markdown blockquote `> ` under the item). Never show bare
   text without category.
2. **One at a time.** Never batch-present candidates. Each gets its own decision.
3. **Default is skip.** No auto-accept. Every candidate requires explicit decision.
4. **Skip-all exits the category.** Don't force the user through noise.
5. **Accepted items are removed from pending.** The file shrinks after review.
6. **Never auto-write to LESSONS.md without confirmation.** Show what will be
   appended before writing.

## Process

### Step 1 — Parse pending

Read `.agent/lessons-pending.md`. Parse into candidates:

- Category header: `### <Category Name>`
- Candidate item: `- [ ] <text>`
- Context (optional): `  > <excerpt>` on the line immediately following the item

If no pending file exists, or it has no `- [ ]` items: "No pending lessons to review."

### Step 2 — Show summary

```
Pending lessons review — <N> candidates across <M> categories:

  Danger zones: <count>
  Gotchas: <count>
  Decisions made: <count>
  Anti-patterns: <count>
  Always do: <count>

Start review? (y/n)
```

### Step 3 — Review loop

For each candidate, one at a time:

```
### <Category> (<position>/<total-in-category>)

<text>

> <context excerpt, if available>

Accept / Skip / Edit / Skip-all-in-<category> / Promote-global / Quit?
(a/s/e/sa/g/q)
```

**Actions:**

| Key | Action | What happens |
|-----|--------|-------------|
| `a` | Accept | Append to project `LESSONS.md` under matching category. Remove from pending. |
| `s` | Skip | Remove from pending. Do NOT add to LESSONS.md. |
| `e` | Edit | "Revised text:" — accept edited text. Then treat as accept (append to LESSONS.md, remove from pending). |
| `sa` | Skip all in category | Skip all remaining items in this category (remove from pending, no LESSONS.md). Jump to next category or finish. |
| `g` | Promote-global | Append to `~/.pi/agent/LESSONS.md` under matching category. Remove from pending. Create global file if it doesn't exist. |
| `q` | Quit | Stop review. Keep remaining items in pending. Report how many reviewed, how many accepted. |

### Step 4 — Write LESSONS.md

After each accept, write immediately (incremental append — don't batch
to end, to avoid data loss on failure).

**If project LESSONS.md doesn't exist:**
```markdown
# Lessons Learned — <project-name>

> Project-specific patterns, danger zones, and gotchas.
> Loaded at session start.
```

Create with this header, then append accepted items.

**Appending an item to existing LESSONS.md:**

Find the matching category section (`## <Category>`). If the category
doesn't exist, create it at the end. Append the item as a bullet:

```markdown
- <text>
```

If the item has context, include it as a sub-bullet comment:

```markdown
- <text> <!-- <context excerpt> -->
```

**Global LESSONS.md (`~/.pi/agent/LESSONS.md`):**

Same format, but the header is:

```markdown
# Cross-Project Lessons

> Patterns that apply across projects. Loaded at session start alongside
> the project-specific LESSONS.md.
```

### Step 5 — Rewrite pending file

After all candidates are reviewed (or quit):

1. Re-read the current pending file.
2. Remove all items that were accepted, skipped, or edited.
3. Remove empty `### Category` sections (categories with no remaining items).
4. Remove date headers (`## YYYY-MM-DD HH:MM — extracted candidates`) that have
   no remaining items.
5. If all items are gone: delete the file entirely, or leave the header with
   "> No pending candidates." if the user prefers.

### Step 6 — Report

```
Review complete: <N> reviewed, <M> accepted (project), <P> promoted (global),
<Q> skipped, <R> remaining.

Updated: LESSONS.md (+<M> items), lessons-pending.md (rewritten)
```

## Quick reference

| Input | Action |
|-------|--------|
| `y` | Start review |
| `a` | Accept → project LESSONS.md |
| `s` | Skip → remove from pending |
| `e` | Edit text, then accept |
| `sa` | Skip all in current category |
| `g` | Promote to global LESSONS.md |
| `q` | Quit, keep remaining in pending |

## Anti-patterns

- **Don't auto-accept.** Every candidate requires an explicit keypress.
- **Don't batch-present.** One at a time, category + position info.
- **Don't write LESSONS.md in bulk at the end.** Incremental appends — lose 1 on crash, not all N.
- **Don't skip showing context when available.** The `> ` blockquote line is the
  extract-patterns context excerpt. It's the most useful signal for judging whether
  a candidate is actionable.
- **Don't delete the pending file when quitting.** Only remove items that were
  explicitly accepted/skipped/edited. `q` leaves the rest intact.
