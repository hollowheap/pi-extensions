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
  "deterministicCompaction": false,
  "redactSecrets": true,
  "notifyErrors": false
}
```

- `enabled`: default `false`.
- `model`: provider and model ID separated by `/`. Required when enabled.
- `observeAfterTokens`: minimum estimated tokens of unobserved conversation before an observer call, default 20000, range 1000–200000.
- `maxObservations`: maximum active observations, default 50, range 1–200.
- `injectionTokens`: maximum memory text added to a compaction summary, default 2000, range 100–20000.
- `deterministicCompaction`: use saved observations to compact fully covered history without a compaction model call. Defaults to `false`.
- `redactSecrets`: redact common credentials before observer calls and stored observations, default `true`.
- `notifyErrors`: show observer and compaction failures, default `false`.

## How it works

- On `agent_settled`, the extension selects message entries that no memory entry has consumed.
- It serializes the conversation, applies redaction when enabled, and calls the configured observer model.
- The observer returns JSON observations with relevance scores.
- Each observation is appended as a `hollowheap.memory.observation` custom session entry. Empty observer results append a `hollowheap.memory.consumed` marker so the same messages are not processed again.
- On `session_start` and `session_tree`, observations restore from the active branch.
- Model-assisted compaction uses active memory as additional focus. With deterministic compaction enabled, eligible history uses saved observations and preserves the previous summary and tracked files. Incomplete coverage, split turns, custom instructions, and results over the configured budget use model-assisted compaction.
- The observer and model-assisted compaction record available provider usage in the shared `hollowheap.usage` ledger. `pi-usage` refreshes through the `usage:refresh` event.

Memory is branch-local and never writes a separate memory file. Navigating to a branch without an observation removes it from that branch.

## Tools

- `memory_search` searches active observations and reflections by keyword. It returns up to 20 matches (default 5) with IDs, relevance, and timestamps.
- `memory_remember` stores one durable fact as an observation. It deduplicates exact text and honors `redactSecrets`.

Both tools require `enabled: true`. They are agent-invoked only, so they add no per-turn context cost.

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

- Reflections and a dropper are not implemented. `memory_search` and `memory_remember` are the agent-facing tools.
- No ongoing context injection outside compaction.
- No debug log or file-based memory store.
- ACP sessions do not register the extension.
