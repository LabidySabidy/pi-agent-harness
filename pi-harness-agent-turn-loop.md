# Pi Harness — AgentSession Turn Loop

Zoom into the single most complex component: the `AgentSession` turn loop
(one user prompt → one or more model calls → tool executions → persistence).

Color legend (same as `pi-harness-overview.md`):

- **gray** = deterministic script, file, or config
- **purple** = model call (inferential judgment)
- **amber** = gate / guard / check

```mermaid
flowchart TD
    classDef gray fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,color:#1f2937
    classDef purple fill:#ede9fe,stroke:#7c3aed,stroke-width:1px,color:#1f2937
    classDef amber fill:#fef3c7,stroke:#d97706,stroke-width:1px,color:#1f2937

    queue["Message queue<br/>steer() · followUp() — user steering"]:::gray
    intake["Prompt intake<br/>append msg · expand templates · images — deterministic"]:::gray
    context["Context build<br/>tree leaf→root · compaction · serialize — deterministic"]:::gray
    sysprompt["System prompt assembly<br/>base prompt + AGENTS.md + skills — deterministic"]:::gray
    gate["Token budget gate<br/>context &gt; window − reserve? → compact — check"]:::amber
    model["Model call<br/>inference: text, thinking, tool calls — model-driven"]:::purple
    stop["Stop check<br/>stopReason: stop / toolUse / length / error — check"]:::amber
    dispatch["Tool dispatch<br/>route to built-in or extension executor — deterministic"]:::gray
    execute["Tool execution<br/>bash/read/write/edit on fs &amp; shell — deterministic"]:::gray
    result["Result append<br/>append ToolResultMessage — deterministic"]:::gray
    persist["Persist &amp; emit<br/>JSONL append · events · usage totals — deterministic"]:::gray
    compaction["Compaction<br/>serialize → LLM summary → entry — model-driven"]:::purple
    fs["Filesystem / shell<br/>project files · shell processes"]:::gray

    queue -->|"queue"| intake
    intake -->|"user message"| context
    context -->|"messages + summaries"| sysprompt
    sysprompt -->|"full prompt"| gate
    gate -->|"messages (within budget)"| model
    model -->|"stopReason"| stop
    stop -->|"toolUse → dispatch"| dispatch
    dispatch -->|"tool name + args"| execute
    execute -->|"output · exit code"| result
    result -->|"new entries"| persist
    result -->|"tool result (turn loop)"| model
    gate -->|"overflow"| compaction
    compaction -->|"summary + firstKeptEntryId (rebuild)"| context
    execute <-->|"files"| fs
```

## Feedback loops

1. **Turn loop** — `result → model`: tool output feeds the next inference call
   until `stopReason` is `stop`.
2. **Compaction recovery** — `gate → compaction → context`: on context
   overflow the old span is summarized and the context is rebuilt before the
   aborted turn is retried.
3. **User steering** — `queue → intake`: `steer()`/`followUp()` messages are
   delivered at the next turn boundary.

Each step is labeled deterministic vs model-driven in its subtitle; only
**Model call** and **Compaction** are model-driven (purple).
