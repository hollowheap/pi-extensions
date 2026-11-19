# pi-memory

Observational memory for the Pi coding agent. An observer model distills durable facts from the conversation, stores them as Pi custom session entries, and adds them to compaction summaries so they survive context loss.

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
- `maxObservations`: maximum active observations and separately retained workspace observations, default 50, range 1–200.
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

In trusted projects, new observations are also saved under `.pi/memory/` at the nearest project marker or Git root. That store retains the newest observations up to `maxObservations`, with the source session and redaction policy recorded. Session observations, reflections, and consumed markers continue to follow the active branch. Workspace observations are available to recall and stay out of branch compaction.

## Tools

- `memory_search` searches active observations and reflections by keyword. It returns up to 20 matches (default 5) with IDs, relevance, and timestamps.
- `memory_remember` stores one durable fact as an observation. It deduplicates exact text and honors `redactSecrets`.
- `memory_recall` is a codemode-only search of observations. The default `session` scope searches the active branch. Set `scope: "workspace"` to search saved observations across sessions in the current workspace.

These tools require `enabled: true`.

## Commands

- `/memory status` shows enabled state, model, session and workspace observation counts, pending tokens, last observer usage, and config diagnostics. `/memory status workspace` shows the workspace count.
- `/memory view` opens session observations and reflections in a Markdown pager. `/memory view workspace` opens workspace observations.
- `/memory clear` confirms, then appends a tombstone that clears current session observations and marks current messages consumed. Workspace copies have separate retention.
- `/memory migrate` imports active observations from saved Pi sessions in the same workspace. It follows a fork's saved ancestry to keep the original workspace and session ID and skips observations whose origin cannot be verified. It honors each branch's clear records, applies the current redaction setting, and leaves the original sessions intact. Repeating it adds no duplicates.

## Privacy and spend

- The observer sees user and assistant text, tool-call arguments, and truncated tool results. It does not see assistant thinking.
- Redaction is best-effort pattern matching. It is not a guarantee. Disable the feature or choose a local model when conversation contents must not leave the machine.
- Observer calls use the configured model and consume provider tokens. Rate control comes from `observeAfterTokens`, `maxObservations`, and `injectionTokens`.
- Observations become model-visible context during compaction. Treat generated memory as untrusted text.

## Limits

- Reflections and a dropper are not implemented.
- No ongoing context injection outside compaction.
- ACP sessions do not register the extension.
