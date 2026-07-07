# Extension API Verification — Pi ≥0.74 (actual: 0.80.3)

> Generated from inspection of `@earendil-works/pi-coding-agent` installed at
> `~/.npm-global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
> and `@earendil-works/pi-ai/dist/types.d.ts`.

---

## 1. Full list of extension lifecycle events

**Session events:**
| Event | Fires when | Cancellable |
|---|---|---|
| `project_trust` | Project trust check needed | Via return `{ trusted }` |
| `resources_discover` | After session_start (startup/reload) | Via return `{ skillPaths, promptPaths, themePaths }` |
| `session_start` | Session started/loaded/reloaded | No |
| `session_info_changed` | Session name/metadata changed | No |
| `session_before_switch` | Before switching to another session | Via return `{ cancel }` |
| `session_before_fork` | Before forking from an entry | Via return `{ cancel }` |
| `session_before_compact` | Before context compaction | Via return `{ cancel, compaction }` |
| `session_compact` | After context compaction | No |
| `session_shutdown` | Extension runtime torn down (quit/reload/new/resume/fork) | No |
| `session_before_tree` | Before navigating session tree | Via return `{ cancel, summary }` |
| `session_tree` | After navigating session tree | No |

**Agent/turn events:**
| Event | Fires when | Cancellable |
|---|---|---|
| `input` | User input received, before agent processing | Via return `{ action: "handled" }` or `"transform"` |
| `before_agent_start` | After system prompt assembled, before agent loop | Via return `{ systemPrompt, message }` |
| `agent_start` | Agent loop starts | No |
| `agent_end` | Agent loop ends | No |
| `turn_start` | Each turn starts | No |
| `turn_end` | Each turn ends | No |

**Message events:**
| Event | Fires when | Modifiable |
|---|---|---|
| `message_start` | A new message starts | No |
| `message_update` | Token-by-token streaming update | No |
| `message_end` | A message ends | Via return `{ message }` |

**Provider events:**
| Event | Fires when | Modifiable |
|---|---|---|
| `context` | Before each LLM call | Via return `{ messages }` |
| `before_provider_request` | Before provider request sent | Via return value (replaces payload) |
| `after_provider_response` | After provider response received | No |

**Tool events:**
| Event | Fires when | Cancellable |
|---|---|---|
| `tool_call` | Before a tool executes | Via return `{ block }` |
| `tool_result` | After a tool executes | Via return `{ content, details, isError }` |
| `tool_execution_start` | Tool execution starts | No |
| `tool_execution_update` | Streaming/partial tool output | No |
| `tool_execution_end` | Tool execution finishes | No |

**Other events:**
| Event | Fires when |
|---|---|
| `model_select` | User switches model |
| `thinking_level_select` | User changes thinking level |
| `user_bash` | User runs `!` or `!!` bash commands |

**Total: 28 distinct event types** — confirms `session_start`, `session_shutdown`, `agent_end`, `input` are present. Additional events beyond the UPGRADE doc's four include `session_before_compact`, `context`, `before_provider_request`, `turn_start`/`turn_end`, and granular message/tool lifecycle events.

**Deviation from UPGRADE doc references**: The UPGRADE doc anticipated `session_before_compact`, `context` events and asked to check for them — both exist. No `session_before_shutdown` event exists; extensions only get `session_shutdown` (non-cancellable).

---

## 2. Footer/status-line API

**YES — a footer/status-line API exists.** Two mechanisms:

### `ctx.ui.setStatus(key, text)` — lightweight status text
```typescript
/** Set status text in the footer/status bar. Pass undefined to clear. */
setStatus(key: string, text: string | undefined): void;
```
Extensions can set keyed status lines. Multiple extensions can each have their own key without conflict. This is the pit board's preferred mechanism — render from local JSON, zero model calls.

### `ctx.ui.setFooter(factory)` — full custom footer component
```typescript
setFooter(factory: (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void }) | undefined): void;
```
For more complex rendering, extensions can replace the entire footer. The `ReadonlyFooterDataProvider` exposes git branch and extension statuses from `setStatus()`.

**Decision for pit board (Phase 3):** Use `ctx.ui.setStatus("pit-board", <line>)` updated from telemetry data. Zero model calls, zero measurable latency. Fall back to `session_start` banner if `setStatus` is unavailable (though it's confirmed present in 0.80.3).

---

## 3. Per-message token usage and cost exposure

**YES — token usage and cost are exposed to extensions**, but not via a direct method on `ExtensionAPI`. They are accessible through:

### Via `agent_end` event messages
```typescript
pi.on("agent_end", async (event, ctx) => {
  for (const msg of event.messages) {
    if (msg.role === "assistant") {
      // msg is AssistantMessage
      msg.usage        // Usage { input, output, cacheRead, cacheWrite, cost }
      msg.usage.cost   // { input, output, cacheRead, cacheWrite, total }
      msg.model        // model name
      msg.provider     // provider id
    }
  }
});
```

The `Usage` type:
```typescript
interface Usage {
  input: number;          // input tokens
  output: number;         // output tokens (includes reasoning)
  cacheRead: number;      // cache read tokens
  cacheWrite: number;     // cache write tokens
  cacheWrite1h?: number;  // 1h-retention cache write subset (Anthropic only)
  reasoning?: number;     // reasoning tokens (subset of output, provider-specific)
  cost: {
    input: number;        // USD
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

### Via `ExtensionContext.getContextUsage()`
```typescript
ctx.getContextUsage()  // ContextUsage { tokens, contextWindow, percent }
```
Only provides aggregate context-fill percentage, not per-message breakdown.

**Conclusion**: For the telemetry extension (Phase 1), token/cost data must be extracted from `AgentMessage.usage` on assistant messages in the `agent_end` event. An estimator fallback (`"chars4"`) is needed for providers/models that don't report usage (e.g., some OpenRouter models). The `pi-ai` estimator is available via `"pi-ai"` but usage data on messages is preferred when present.

---

## 4. `pi.registerCommand` signature

```typescript
registerCommand(name: string, options: {
  description?: string;
  getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}): void;
```

- `name` — the slash command name (invoked as `/name`)
- `description` — shown in slash command picker
- `getArgumentCompletions` — optional async autocomplete for arguments
- `handler` — receives the argument string and an `ExtensionCommandContext` (extends `ExtensionContext` with session control methods: `newSession`, `fork`, `navigateTree`, `switchSession`, `reload`, `waitForIdle`)
- `sourceInfo` is auto-populated by the framework (not passed by the extension)

The `ExtensionCommandContext` available to the handler adds:
```typescript
await ctx.waitForIdle();           // wait for agent to finish streaming
await ctx.newSession({ ... });     // start new session
await ctx.fork(entryId, { ... });  // fork from entry
await ctx.navigateTree(id, {...}); // navigate session tree
await ctx.switchSession(path, {}); // switch to different session
await ctx.reload();                // reload extensions/skills/themes
```

**Implementation note for telepi-handoff.ts (read-only reference):** The file at `agent/extensions/telepi-handoff.ts` is TelePi-owned and must never be modified per ground rule #3. Its `registerCommand` usage was checked for this verification and is consistent with the signature above.
