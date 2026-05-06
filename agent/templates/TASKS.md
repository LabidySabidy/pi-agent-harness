# Tasks — <Project Name>

> Granular task list. Each task ID is `T-NNN`. Once contract-gen is active, each task may have a corresponding `.agent/tasks/T-NNN/CONTRACT.json`.

## Active

- [ ] T-001 — <task description>
  - **Done when:** <testable criterion — e.g. `pytest tests/foo.py passes`, `curl /endpoint returns 200`>
  - **Estimate:** <hours — optional, omit if obvious>
- [ ] T-002 — <task description>
  - **Done when:** <testable criterion>
  - **Estimate:** <hours — optional, omit if obvious>

## In progress

- [ ] T-NNN — <task description> (started <date>, by <session/skill>)

## Done

- [x] T-000 — <completed task> (<date>)

## Blocked

- [ ] T-NNN — <task description>
  - **Blocked on**: <dependency or unanswered question>
  - **Action needed**: <what would unblock it>

## Format conventions

- Task IDs increment monotonically across the project's lifetime — never reuse an ID, even for deleted tasks.
- A task is "active" if it's queued and ready; "in progress" if a session is currently working on it; "done" if its acceptance criteria are met; "blocked" if it can't proceed without resolving a dependency.
- Move tasks between sections as state changes. Don't delete completed tasks — they're a record.
- For larger tasks (>1 session of work), spawn subtasks under it rather than letting it grow.
