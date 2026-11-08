# Review — pi-memory (V19)

## Scope

- Commit: a035b03 (HEAD of main). Feature introduced in 51e40e9.
- Paths (non-test source, about 1060 LOC):
  - extensions/pi-memory/src/index.ts (487)
  - extensions/pi-memory/src/observer.ts (170)
  - extensions/pi-memory/src/config.ts (171)
  - extensions/pi-memory/src/ledger.ts (200)
  - extensions/pi-memory/src/redact.ts (32)
- Architecture contract: artifacts/architecture.md:30.
- Host contracts read: pi-coding-agent `dist/core/extensions/types.d.ts` (session events, `SessionBeforeCompactEvent.signal`), `dist/core/model-registry.d.ts` (`find`, `getApiKeyAndHeaders`, `complete`), `compact` in `dist/core/compaction/compaction.d.ts`; pi-ai `types.d.ts` (`StopReason` includes `"error"`, `errorMessage`).
- Lenses: robustness, UI, backend, performance, simplicity.
- Probes: two out-of-tree jiti scripts that drove `createMemoryExtension` with a fake `pi` and `ctx`. They ran from /tmp and were deleted, because this review may create only this file. Probe snippets are described under each finding so they can be re-run.
- Baseline from brief: `npm test` 1052/1052, typecheck and lint clean. Not re-run.

## Findings

### F1 — high — backend / robustness

- Current: extensions/pi-memory/src/observer.ts:152-157 reads only `response.content` text. `stopReason` and `errorMessage` are ignored.
  extensions/pi-memory/src/index.ts:277-278:
  `if (result.observations.length === 0) { pi.appendEntry(MEMORY_CONSUMED_TYPE, { sourceEntryIds: entryIds }); }`
- Gap: a failed model response (empty content, `stopReason: "error"`) produces zero observations. The same path treats that as "nothing to remember" and permanently marks the source messages consumed. The same happens when a response is cut off by `MAX_RESPONSE_TOKENS` (observer.ts:27) and the JSON does not parse (observer.ts:29 `parseJson` returns undefined, so parse yields []).
- Failure/impact: one transient provider error (rate limit, 5xx, overload) silently and permanently drops memory for every message in that chunk. Nothing is notified, and the next turn observes only newer messages. The source messages remain in the session, but the observer never sees them again.
- Reproduction: out-of-tree probe. Fake `registry.complete` returned `{content: [], stopReason: "error", errorMessage: "429 rate limited", usage: {...}}`. Config `enabled: true, model: "provider/model-id", observeAfterTokens: 1000`. The branch had one user message of 6000 chars (id `m1`). Three `agent_settled` events, 50 ms apart. Result: `observeCalls: 1`, `appendEntry` called with `hollowheap.memory.consumed` and `sourceEntryIds: ["m1"]`, and `notes: []`. No retry happened. Repeat with a `throw` instead of an error response: `observeCalls: 3`, no consumed entry. The error shape decides whether data is lost or retried.
- Fix (minimal): in `observeConversation`, after `complete`, throw when `response.stopReason` is `"error"` or `"aborted"`, or when it is `"length"` and no observation parsed. Throw `new Error(response.errorMessage ?? response.stopReason)`. The existing catch at index.ts:299-311 then leaves the chunk unconsumed. Keep the `aborted` check in index.ts:276 as is.
- Confidence: high for the code path (probe). Medium that real providers return `stopReason: "error"` instead of throwing. The probe uses the shape from pi-ai `types.d.ts`. Live provider behavior: UNVERIFIED.

### F2 — medium — robustness / performance

- Current: extensions/pi-memory/src/index.ts:224-237 serializes all pending messages (`serializeConversation(convertToLlm(...))`) and checks the token threshold before resolving the model. `ctx.modelRegistry.find` runs at index.ts:236, and `if (model === undefined) return;` runs at index.ts:237.
  extensions/pi-memory/src/config.ts:65-79 (`parseModel`) checks only the `provider/model-id` shape. It does not check the registry, so a typo produces no diagnostic.
- Gap: a configured model that the registry does not know is never reported. `/memory status` shows `model: provider/typo` and nothing else. Pending messages are never consumed, so every settled turn serializes the full pending set again. Pending keeps growing with the session.
- Failure/impact: the observer silently never runs. Per-turn serialization cost grows with session length and is paid on every turn.
- Reproduction: out-of-tree probe. Config `model: "provider/typo-model"`. Branch of 20 messages, 4000 chars each. `loadMemoryConfig(...).diagnostics` returned `[]`. Five `agent_settled` events gave `find` calls: 5, and `appendEntry` calls: 0. Each turn serialized about 80k chars before the `find`.
- Fix (minimal): resolve the model at the top of `maybeObserve`, before serialization. Return early when it is missing. Add a diagnostic in `loadMemoryConfig` or in `/memory status` when `find` returns undefined. Optionally consume nothing and notify once per session.
- Confidence: high (probe, plus code order at index.ts:224-237).

### F3 — medium — robustness / UI

- Current: extensions/pi-memory/src/index.ts:296-311 catch block. It notifies only when `config.notifyErrors && ctx.hasUI` (index.ts:302). extensions/pi-memory/src/config.ts:159-160 defaults `notifyErrors` to `false`. Compaction failures use the same gate (index.ts:371-377).
- Gap: observer failures are silent by default, and nothing limits retries. The chunk stays unconsumed, so the next `agent_settled` retries the same request. There is no backoff and no failure count.
- Failure/impact: during a provider outage, every settled turn sends one paid request that fails. The user sees no message. The memory feature appears to be working but is not.
- Reproduction: same probe as F1, with `complete` throwing `ECONNRESET`. Three `agent_settled` events gave `observeCalls: 3`, and `notes: []` with the default config.
- Fix (minimal): keep a consecutive-failure counter in the closure. After one failure, notify once per streak (regardless of `notifyErrors`). Skip the observer for N turns or until new message count grows by a threshold. Reset on success.
- Confidence: high (probe). Cost impact: UNVERIFIED, because provider pricing and outage length were not measured.

### F4 — medium — simplicity

- Current: extensions/pi-memory/src/ledger.ts:4 (`MEMORY_REFLECTION_TYPE`), ledger.ts:112-116 (replay into `ledger.reflections`), ledger.ts:129 (clear reset). index.ts:111-115 (render "Reflections"), index.ts:427 (status count), index.ts:443, 456, 464, 477 (clear checks and resets).
- Gap: reflections are read, rendered, counted, and cleared, but nothing in the repository writes `MEMORY_REFLECTION_TYPE`. A search of the repo for `MEMORY_REFLECTION_TYPE` and `hollowheap.memory.reflection` finds only ledger.ts and ledger.test.ts.
- Failure/impact: dead state and dead rendering that every reader must reason about. The status line always shows `reflections: 0`. Any future writer would have no tested path, since the only tests seed the entry by hand.
- Reproduction: `grep -rn "MEMORY_REFLECTION_TYPE\|hollowheap.memory.reflection" --exclude-dir=node_modules .` returns only ledger.ts and ledger.test.ts.
- Fix (minimal): delete the reflection type, parse, replay, render, status line, and clear references. If reflections are planned, record that in artifacts/decisions.md and leave one TODO.
- Confidence: high.

### F5 — low — robustness

- Current: extensions/pi-memory/src/index.ts:96-105 `serializePending`. Line 101-102: `if (text.length >= maxChars) { text = text.slice(0, maxChars); break; }`. The entry that crosses the limit is pushed into `entries` before the cut.
- Gap: when one message is larger than `maxChars` (up to 120k chars, index.ts:42), its text is cut, and its id is still returned. index.ts:278 and the observation's `sourceEntryIds` then mark the whole message consumed. The tail is never observed.
- Failure/impact: the tail of an oversized message (for example a large tool output) is silently excluded from memory. Impact is limited to derived facts in very large messages.
- Reproduction: code trace only, not probed. A single 130k-char message: `text` becomes the first 120k chars, `entries` contains the message id, and the id is consumed on success.
- Fix (minimal): either mark the entry consumed only when its whole text was included, or accept the cut and document it in the observer prompt. Pick one. The first option means a multi-chunk split, which is larger than needed.
- Confidence: high for the trace. Impact is judged low, because the source text stays in the session.

### F6 — low — backend (redaction quality)

- Current: extensions/pi-memory/src/redact.ts:16 `/\bBasic\s+[A-Za-z0-9+/=]{10,}\b/gi`, and redact.ts:15 for Bearer.
- Gap: the `Basic` pattern matches any English word of 10 or more letters after the word "Basic". The pattern has no check for credential shape.
- Failure/impact: ordinary prose is replaced by `[REDACTED]` before the observer sees it or before memory is stored, so memory loses content.
- Reproduction (probe): `redactSecrets("Use Basic configuration files here")` returns `"Use [REDACTED] files here"`.
- Fix (minimal): require the `Basic` token to contain a digit or end in `=`, or require a preceding `Authorization:` header. Add one test for prose.
- Confidence: high.

### F7 — low — simplicity (speculative surface)

- Current: extensions/pi-memory/src/config.ts:14 `readonly path: string` is set at config.ts:163 and has no reader in the slice. config.ts:88 and config.ts:167-168 `onDiagnostic` parameter has no production caller (index.ts calls `loadMemoryConfig(resolveAgentDir())` at index.ts:145). The truncation constant is duplicated: index.ts:43 and observer.ts:26, plus a second slice at index.ts:284 after `parseObservationResponse` already slices at observer.ts:75.
- Gap: unused config field, unused callback, and two copies of the same 500-char limit.
- Failure/impact: none at runtime. Each one makes the next change harder to get right.
- Reproduction: `grep -n "\.path\b\|onDiagnostic" extensions/pi-memory/src/*.ts` (non-test) shows no reader for `config.path` and no production caller for `onDiagnostic`.
- Fix (minimal): delete `path` and `onDiagnostic`. Export one `MAX_OBSERVATION_CHARS` from observer.ts and drop the second slice at index.ts:284.
- Confidence: high.

### F8 — low — performance

- Current: extensions/pi-memory/src/index.ts:469-473 `clearMemory`: `messageEntryIds(ctx.sessionManager.getBranch())` writes every message id on the branch into one `MEMORY_CLEAR_TYPE` entry.
- Gap: the clear entry grows linearly with branch length, and each clear repeats the full list. Replay (`ledger.ts` `memoryFromEntries`) also adds all ids to `consumedIds`.
- Failure/impact: a long session with repeated clears grows the session file by O(messages) per clear. Size for a typical session is UNVERIFIED, because no measurement was taken.
- Reproduction: code trace only.
- Fix (minimal): record a marker (for example the leaf id or a timestamp). Do not copy every id. Replay can skip consumed checks for messages older than the clear entry.
- Confidence: medium. Size and real impact are UNVERIFIED.

## Failure modes

- Provider error, rate limit, or truncated JSON response: chunk consumed without a retry (F1). Data loss of derived facts.
- Provider down or throwing: one request per settled turn, no notice by default (F3).
- Misconfigured model name: observer never runs, no diagnostic, per-turn serialization of pending messages (F2).
- Overlapping turns: the `observing` flag (index.ts:213) blocks a second observer. It is set synchronously before the first `await`, and `maybeObserve` has no await before it. Probe not run. Code trace only.
- Session switch, fork, or tree navigation during an in-flight observer: `session_shutdown` (index.ts:329-331) and `restore` (index.ts:154-156) call `abortObserver`, which bumps `generation`. The late result is discarded at index.ts:276 and no entry is written. Code trace only, not probed. Chunk is not consumed, so the messages are observed again later. Duplicates are filtered by `existing` in `parseObservationResponse`.
- `/memory clear` during the confirm dialog: a finishing observer can append an observation before the clear entry. The clear entry then removes it. Acceptable and consistent with branch-local replay.
- Oversized single message: tail dropped silently (F5).
- Compaction abort: `compact` throws, the catch notifies only if `notifyErrors` (index.ts:371-377). Pi then uses its default compaction. Fail-safe.
- Config errors: JSON parse errors and out-of-range values fall back to defaults and set `enabled: false` or a bounded default. Diagnostics appear only in `/memory status` (config.ts:105 and the `diagnostics` array returned by `loadMemoryConfig`). Fail-safe.

## Seams

- `MemoryExtensionDeps` (index.ts:45-49) injects `getAgentDir`, `observe`, and `compact`. Tests use all three. Production uses one adapter each. The seam is justified by tests and is not a single-use abstraction beyond that.
- `observeConversation` takes `ModelRegistry` directly. It is a host type, so no extra port is needed.
- `ledger.ts` is pure: replay and render take plain values. Good seam for tests.
- `redact.ts` is pure and shared by observer and compaction.
- Config is read from disk on every `agent_settled` (index.ts:214), every compaction (index.ts:343), and every status call. This is a second seam between file and runtime, with no caching and no invalidation. The file is small, so the cost is tolerated (see Rejected defaults).

## Rejected defaults

- `readFileSync` of `memory.json` per settled turn (config.ts:86 via index.ts:145, 214). The file is small. Cost not measured, but the read is minor next to a model call. Not a finding.
- `notifyErrors: false` default (config.ts:157-160). Intentional quiet default. Its interaction with retries is covered by F3.
- Redaction on by default (`redactSecrets: true`). Observation text is redacted before it is written (observer.ts:166, `redact` branch). Prompt conversation and existing observations are redacted before the call (observer.ts:90 `buildObserverPrompt`). No secrets in logs. Only ids are written for consumed entries.
- Abort propagation: observer uses its own `AbortController` (index.ts:263), and compaction uses `event.signal` (index.ts:362). Both are host-supplied or local, not leaked.
- Timers and listeners: none created in this slice. `pi.on` subscriptions are host-owned. No cleanup to add.
- UI width: the `/memory view` pager (packages/tui/src/pager.ts:90-98) applies `truncateToWidth` to every line. The slice's status text is a plain `notify` string. No width findings in pi-memory.
- Empty, loading, and error states: `/memory view` and `/memory clear` have explicit "no memory" notices (index.ts:441-457). `/memory status` always renders. Passes.
- Prompt growth bounds: `maxObservations` capped at 200 (config.ts:21), injection capped at 20k tokens (config.ts:24), observer prompt includes at most 20 existing observations (observer.ts:97). Bounded.
- `process.env.PI_ACP` guard (index.ts:135). Intentional opt-out for ACP mode.
- `randomUUID` per observer call used as `sessionId` (observer.ts). Intentional isolation of provider cache. Cheap.

## Open Questions

1. Architecture conflict: artifacts/architecture.md:30 says pi-memory "does not replace Pi compaction". index.ts:370 returns `{ compaction: result }` from its own `compact` call whenever memory is non-empty, so this extension produces the compaction summary. Which contract should win? The answer decides whether the handler should only add instructions or should own the summary.
2. Observations come from tool output and web content, and they are injected "verbatim" into compaction instructions (index.ts:355). Should observer output be treated as untrusted before it reaches a compaction prompt? The current code has no sanitization beyond secret redaction.
3. On repeated observer failure, should the chunk be dropped after N retries, or kept and retried? F1 and F3 depend on this policy.
4. Are reflections a planned feature? F4 deletes them if the answer is no.

## Verdict

pass-with-findings

F1 (high) must be fixed before the observer output is trusted. F2 and F3 are the next priority. F4 to F8 are cleanup.
