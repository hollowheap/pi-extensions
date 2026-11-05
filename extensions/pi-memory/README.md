# pi-memory

Session-local observational memory for the Pi coding agent. An observer model distills durable facts from the conversation, stores them as Pi custom session entries, and adds them to compaction summaries so they survive context loss.

The extension is disabled by default. It makes no model calls until `enabled` is true and `model` names a provider/model pair.

## Try it

```bash
pi -e ./extensions/pi-memory
```

## Configuration

Create `<agentDir>/memory.json`:

```json
{
  "enabled": true,
  "model": "provider/model-id",
  "observeAfterTokens": 20000,
  "maxObservations": 50,
  "injectionTokens": 2000,
  "redactSecrets": true,
  "notifyErrors": false
}
```

- `enabled`: default `false`.
- `model`: provider and model ID separated by `/`. Required when enabled.
- `observeAfterTokens`: minimum estimated tokens of unobserved conversation before an observer call, default 20000, range 1000–200000.
- `maxObservations`: maximum active observations, default 50, range 1–200.
- `injectionTokens`: maximum memory text added to a compaction summary, default 2000, range 100–20000.
- `redactSecrets`: redact common credentials before observer calls and stored observations, default `true`.
- `notifyErrors`: show observer and compaction failures, default `false`.

## How it works

- On `agent_settled`, the extension selects message entries that no memory entry has consumed.
- It serializes the conversation, applies redaction when enabled, and calls the configured observer model.
- The observer returns JSON observations with relevance scores.
- Each observation is appended as a `hollowheap.memory.observation` custom session entry. Empty observer results append a `hollowheap.memory.consumed` marker so the same messages are not processed again.
- On `session_start` and `session_tree`, observations restore from the active branch.
- On `session_before_compact`, active memory is passed to Pi's normal compaction path as additional focus. Memory does not replace compaction.
- Observer usage is written to the shared `hollowheap.usage` ledger and `pi-usage` refreshes through the `usage:refresh` event.

Memory is branch-local and never writes a separate memory file. Navigating to a branch without an observation removes it from that branch.

## Commands

- `/memory status` shows enabled state, model, observation count, pending tokens, last observer usage, and config diagnostics.
- `/memory view` opens observations and reflections in a Markdown pager.
- `/memory clear` confirms, then appends a tombstone that clears observations and marks current messages consumed.

## Privacy and spend

- The observer sees user and assistant text, tool-call arguments, and truncated tool results. It does not see assistant thinking.
- Redaction is best-effort pattern matching. It is not a guarantee. Disable the feature or choose a local model when conversation contents must not leave the machine.
- Observer calls use the configured model and consume provider tokens. Rate control comes from `observeAfterTokens`, `maxObservations`, and `injectionTokens`.
- Observations become model-visible context during compaction. Treat generated memory as untrusted text.

## Limits

- Observer-only in this version. Reflections, a dropper, and a `recall` tool are not implemented.
- No ongoing context injection outside compaction.
- No debug log or file-based memory store.
- ACP sessions do not register the extension.
