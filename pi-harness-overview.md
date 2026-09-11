# Pi Harness — Architecture Overview

End-to-end view of the pi coding-agent harness (v0.84.3), derived from the
package `README.md`, `docs/` (sdk, compaction, session-format), and `dist/`.

## Assumptions

1. **"The harness" = pi itself** — the coding agent CLI, built on `pi-ai`
   (models), `pi-agent-core` (agent), `pi-tui` (UI), `pi-client`, and
   `pi-protocol`.
2. **Trust gates only project-local resources** (`.pi/`); global resources flow
   in ungated. Both paths are drawn.
3. **Cardinality:** one process → one active `AgentSession` (replaced, never
   concurrent); one model call in flight per turn; N providers/models; N
   extensions/tools.
4. **"Model call" = provider inference** (including the compaction/branch
   summarizer). `ModelRuntime` itself is deterministic orchestration
   (auth + catalog resolution), so it is not marked as a model call.
5. Tools shown as the default set (`read`, `bash`, `edit`, `write`, `grep`,
   `find`, `ls`, `powershell`) plus extension-registered tools.

## Diagram 1 — Overview

```mermaid
flowchart TD
    classDef gray fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,color:#1f2937
    classDef purple fill:#ede9fe,stroke:#7c3aed,stroke-width:1px,color:#1f2937
    classDef teal fill:#ccfbf1,stroke:#0d9488,stroke-width:1px,color:#1f2937
    classDef amber fill:#fef3c7,stroke:#d97706,stroke-width:1px,color:#1f2937

    tui["Interactive TUI<br/>editor, commands, keybindings, queue — 1 per process"]:::gray
    mode["Entry modes<br/>interactive · print · json · rpc · SDK — 1 per process"]:::gray
    trust["Project trust gate<br/>gate on project-local .pi/ resources"]:::amber
    loader["ResourceLoader<br/>context files · skills · prompts · themes · extensions"]:::gray
    ext["Extensions<br/>TypeScript modules — N per project"]:::gray
    runtime["AgentSessionRuntime<br/>owns active session; new/resume/fork/clone/import"]:::gray
    session["AgentSession<br/>agent session with context window — 1 active"]:::teal
    modelrt["ModelRuntime<br/>auth + model catalog resolution — 1 per process"]:::gray
    provider["Provider inference call<br/>model call; Anthropic/OpenAI/DeepSeek — N providers"]:::purple
    builtin["Built-in tools<br/>read, bash, edit, write, grep, find, ls, pwsh"]:::gray
    exttools["Extension tools<br/>custom tools registered by extensions — N"]:::gray
    sm["SessionManager<br/>JSONL tree append + context build — 1 per session"]:::gray

    subgraph storage["Persistent storage"]
        sfiles["Session files<br/>~/.pi/agent/sessions/*.jsonl"]:::gray
        cfg["Config files<br/>settings, auth, models-store, trust (.json)"]:::gray
        ctx["Context / resource files<br/>AGENTS.md, skills, extensions, prompts, themes"]:::gray
    end

    pidev["pi.dev (external)<br/>update check · model catalog · install telemetry"]:::gray

    tui -->|"user prompt · @files · images · slash cmd"| mode
    mode -->|"cwd"| trust
    trust -->|"project .pi/ resources (if trusted)"| loader
    mode -->|"global resources (ungated)"| loader
    loader -->|"extension modules (.ts)"| ext
    loader -->|"skills · prompts · themes · AGENTS.md"| runtime
    ext -->|"registers tools · commands · hooks"| runtime
    runtime <-->|"session lifecycle · events"| session
    session -->|"messages · model id · thinking level"| modelrt
    modelrt -->|"API request (auth · model · messages)"| provider
    provider -->|"text · thinking · tool calls (streamed)"| session
    session -->|"tool call (read/bash/edit/write/…)"| builtin
    session -->|"tool call (custom)"| exttools
    builtin -->|"tool result · filesystem I/O"| session
    exttools -->|"tool result"| session
    session -->|"messages · compaction · labels · model_change"| sm
    sm -->|"JSONL entries (append)"| sfiles
    modelrt -->|"auth.json · models-store.json · trust.json"| cfg
    ctx -->|"read on load"| loader
    modelrt <-->|"model catalog refresh"| pidev
```

## Color legend

- **gray** = deterministic script, file, or config
- **purple** = model call (inferential judgment)
- **teal** = agent session with its own context window
- **amber** = gate / guard / check

## Analysis

Across both diagrams there are **3 purple model-call boxes** (per-turn
inference plus the compaction summarizer) against **22 gray deterministic
boxes** and **3 amber gates** — roughly 1 model call for every 7 deterministic
steps. Cost is therefore confined to those few inference hops even though the
model drives the entire loop; every billed token flows through a purple box.
Reliability risk concentrates exactly there: the provider call is the only
component that can stream partial output, error, or stall, and its failure
path (auto-retry + compaction overflow recovery) is the second-most complex
region. The deterministic plumbing is cheap and frequent but merely amplifies
whatever the model decides, so a bad tool call costs far more to recover from
than a bad summary. In practice, failures cluster at the model-call boundary
and the compaction/overflow loop, not in file I/O or persistence.
