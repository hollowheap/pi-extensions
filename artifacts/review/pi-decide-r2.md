# Review — pi-decide robustness re-review (V35)

Prior: `artifacts/review/pi-decide.md` (V03). `artifacts/review/ui-upgrades.md` (V17) has no pi-decide items (grep for "decide": 0 matches).
Mode: read-only. Probes ran from `/tmp/pi-decide-r2-probe` (deleted after the run).

## Scope

- Slice: `extensions/pi-decide` at HEAD, 669 LOC in `src/decide.ts` (489), `src/config.ts` (161), `src/index.ts` (19).
- Tests: `npx vitest run extensions/pi-decide` passes, 3 files, 30 tests. Tests do not cover cache-hit usage, join-after-abort, or missing-answers-without-signal.
- Recent commits: `6dd8d6e` (report classifier usage in tool result), `615d205`, `98f1994`, `e68aa50`, `f28df22`, `6a7ba53`, `0ca8692`, `01b3ca1`.
- Host: `node_modules/@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai` (read-only).
- Cited files outside the slice: `extensions/pi-usage/src/index.ts`, `packages/core/src/session-cache.ts`.
- Working tree: `extensions/pi-agent` changes ignored per request.

## Prior resolutions

Each line is one V03 Resolution (2026-10-30 or 2026-11-04). Status is at HEAD.

1. Result cache and in-flight dedupe in core session cache, 128-entry cap: holds. `decide.ts:58`, `:198-203`; eviction at `packages/core/src/session-cache.ts:46-50`.
2. Caller abort forwarded; request aborts when last waiter cancels: holds. `decide.ts:116`, `:216-219`. The join-after-abort defect in the same mechanism is F2, not a regression of this resolution.
3. Aborted calls not cached: holds. `decide.ts:272-277`.
4. Choice labels, probabilities, confidence, score range validated: holds. `decide.ts:361-376`, `:394-396`.
5. Score result includes selected label: holds. `decide.ts:399`.
6. Config read failures other than ENOENT report diagnostics: holds. `config.ts:98-104`.
7. Missing `ctx.ui` fails safely: holds. `index.ts:16`.
8. Missing model-registry APIs fail safely: holds. `decide.ts:459-472`.
9. Fake `getAgentDir` default and `decideTool` singleton removed: holds. Only `createDecideTool` is exported (`decide.ts:68`).
10. `DecideDeps`, `defaultDeps`, `Partial` removed: holds. No `DecideDeps` in the slice; `createDecideTool()` takes no arguments (`decide.ts:68`).
11. Tests use real config loader and real `defaultDecide` through a mocked agent dir: holds. `decide.test.ts:16-19`, `:56-59`.

Regressed: 0 of 11.

## Cross-slice impact

- `6dd8d6e` adds usage to every tool result (`decide.ts:259`). Host sums toolResult `message.usage` into session stats (`pi-coding-agent/dist/core/agent-session.js:3466-3469`). This double counts on cache hits and joined calls (F1).
- No double count with pi-usage. `pi-usage/src/index.ts:205-207` reads only assistant `message_end`, and it never subscribes to `tool_result`. The consequence is the opposite gap: decide spend never enters the pi-usage ledger or the budget cap (`index.ts:226`). This matches the cost-source split in `pi-usage-r2.md` F3. Decide prices with the pi-ai catalog (`pi-ai/dist/types.d.ts:504`), a third source beside pi-usage's table and provider `cost.total`.
- V20 (prompt-lock hang, packages/tui): decide bounds only its own await with `requestSignal` (`decide.ts:216-219`, `:271`). A hang in the host lock is outside that bound. Impact only.
- V22 (pricing gaps, packages/core): a model without catalog price reports cost 0, so F1 and the cost totals undercount for that model. Impact only.

## Findings

Mechanism and repro are verified with probes P1-P7 unless marked UNVERIFIED.

### F1 — repeated and joined calls re-report classifier usage
- Severity: medium. Lens: Backend.
- Current: `decide.ts:206-208` returns the stored result on cache hit; `:271-278` returns the shared `result` to every joiner; `:259` puts `usage` on every result.
  ```ts
  const cached = results.get(key);
  if (cached !== undefined) { return cached; }
  ```
- Gap: usage belongs to one model request. Cache hits and joiners carry the same object, so the host counts it again (`agent-session.js:3466-3469`).
- Failure: one 0.001 model call looks like 0.002 after two sequential calls within 600 s (default `cacheTtlMs`), and 0.003 after three concurrent calls.
- Reproduction: `/tmp` probe P1 (sequential) and P2 (concurrent, 3 callers). Output: `P1 classifyCalls 1 usageA 10 usageB 10 hostSumCost 0.002`; `P2 classifyCalls 1 usages [10,10,10] hostSumCost 0.003`.
- Fix: return usage only from the caller that created the entry. Strip `usage` from cache hits and joined results. Add a test that a second identical call has no `usage`.
- Confidence: high.

### F2 — a live caller can join an entry that is already aborting
- Severity: medium. Lens: Robustness.
- Current: `decide.ts:116` aborts the controller when the last waiter leaves. The entry stays in `inflight` until the task settles (`:264`, `:266-269`). `decide.ts:210-213` joins it.
- Gap: the joined entry has an aborted signal and resolves to a failure, which is not cached.
- Failure: a new live call that starts while the old request is aborting gets `decide failed`. The model proceeds without the advisory answer. A retry succeeds.
- Reproduction: probe P3. First call aborted, then second call with no signal. Output: `first { error: 'aborted' } | second(live) { error: 'decide failed' } classifyCalls 1`.
- Fix: delete the entry from `inflight` inside `onAbort` (`decide.ts:116`), or skip joining when `entry.controller.signal.aborted`. Add a test for "join after last-waiter abort starts a new request".
- Confidence: high.

### F3 — usage dropped on every failure path after a billed model call
- Severity: medium. Lens: Backend.
- Current: `decide.ts:234-235` (`stopReason !== "stop"`), `:238-240` (no answer), `:242-244` (kind mismatch), `:254` (normalize error), and `errorResult` at `:424-428` take no usage.
- Gap: pi-ai sets usage before parsing answers, and keeps it on error. `pi-ai/dist/api/openai-decisions.js:148` says "a request with malformed or refused answers was still billed."
- Failure: a billed request that returns invalid output adds zero usage. Spend is undercounted.
- Reproduction: probe P4. Classifier returns `stopReason: "error"` with `usage.input: 10`. Output: `P4 usage on error result: undefined`.
- Fix: pass `result.usage` into `errorResult` on every path after `defaultDecide` returns. Keep the F1 rule so only the creating caller reports it.
- Confidence: high for the code path. Billing of a specific provider is UNVERIFIED.

### F4 — missing answer throws out of execute when the caller has no signal
- Severity: low. Lens: Robustness.
- Current: `decide.ts:102` (`return await entry.promise`) and `:271` (no `try` around `waitForResult` in `executeDecide`). `decide.ts:220-233` never catches a TypeError from `result.answers.answer` (`:236`).
- Gap: the signal path converts a task rejection into an error result (`:127-131`); the no-signal path does not.
- Failure: a `stopReason: "stop"` result without `answers` throws `Cannot read properties of undefined (reading 'answer')` out of `execute`. With a signal, the same input returns `decide unavailable: ...`.
- Reproduction: probe P5. Output: `P5 THREW Cannot read properties of undefined (reading 'answer')`.
- Fix: wrap `await waitForResult(...)` in `executeDecide` with try/catch and return `errorResult`. Or guard `result.answers?.answer`.
- Confidence: high for the mechanism. Whether the host always passes a signal to `execute` is UNVERIFIED.

### F5 — failures are not flagged as tool errors
- Severity: low. Lens: Backend.
- Current: `decide.ts:424-428` returns `{content, details: {error}}` with no `isError`.
- Gap: `pi-agent-core/dist/types.d.ts:386` defines `isError` for "report a failure without throwing."
- Failure: a failed decide call is recorded as a successful tool call. Probe P7 shows `"isError" in r` is `false`.
- Reproduction: probe P7. Output: `P7 isError present: false decide unavailable: boom`.
- Fix: return `isError: true` from `errorResult`.
- Confidence: high for the field. Model-side behavior change is UNVERIFIED.

### F6 — duplicate choice labels collapse silently
- Severity: low. Lens: Backend.
- Current: `decide.ts:300` `criteria[label.label] = label.description;`. Duplicate names are not rejected in `buildQuestion` (`decide.ts:281-302`).
- Gap: `labels` has two entries, but the classifier gets one criterion.
- Failure: the classifier sees `{"allow":"second"}`. The first description is lost, and the question has no valid meaning.
- Reproduction: probe P6. Output: `P6 criteria sent: {"allow":"second"}`.
- Fix: reject when `new Set(labels.map(l => l.label)).size !== labels.length`.
- Confidence: high.

### F7 — dead fields and an unused export
- Severity: low. Lens: Simplicity.
- Current: `config.ts:12-13` (`path`, `diagnostics`). Production code never reads them; only `config.test.ts:27-28` does. `decide.ts:438` exports `defaultDecide`, which has no importer (`grep` over `extensions/pi-decide`).
- Gap: fields and export exist only for tests or nothing.
- Failure: none at runtime. Adds surface that must stay correct.
- Fix: remove `path` and `diagnostics` from `DecideConfig` (or test through `onDiagnostic`). Make `defaultDecide` module-private.
- Confidence: high.

### F8 — four copies of the same error object
- Severity: low. Lens: Simplicity.
- Current: `decide.ts:441-447`, `:453-461`, `:465-472`, `:474-483` each build `Promise.resolve({api, provider, model, answers: {}, stopReason: "error", errorMessage, timestamp})`.
- Gap: the same shape four times.
- Failure: none now. A new error branch must copy the shape again.
- Fix: one local `failed(provider, model, message)` helper.
- Confidence: high.

### F9 — tool text carries usage and model the model does not use
- Severity: low. Lens: Backend.
- Current: `decide.ts:257` `text: JSON.stringify(output)`; `output` includes `usage` and `model` (`decide.ts:385`, `:409`, `:420`).
- Gap: the model-facing text repeats usage that is already on `result.usage` (`:259`).
- Failure: extra context tokens per call. Size is UNVERIFIED.
- Fix: emit only `kind`, `value`, and the confidence or probability fields in `text`.
- Confidence: high for the shape; magnitude UNVERIFIED.

### Lenses with no finding
- UI: decide defines no `renderCall` or `renderResult`. The only `ctx.ui` use is `index.ts:16` (`notify`). Width at 40/80/200 and long labels are host-rendered and UNVERIFIED. No picker keys exist.
- Performance: no finding. See Rejected defaults.

## Failure modes

- Missing config or model: `decide.ts:178-182` returns text. Verified by existing test `returns unavailable when no model is configured`.
- Unknown model, bad model string, missing registry: `defaultDecide` returns a classifier error object (`decide.ts:441-486`). Handled.
- Provider error, truncated or non-JSON output: pi-ai returns `stopReason: "error"` (`openai-decisions.js:157`). Handled, but usage is dropped (F3).
- Timeout: `AbortSignal.timeout` through `AbortSignal.any` (`decide.ts:216-219`). Reaches the provider only if the provider passes `signal` to fetch. Checked for `openai-decisions.js` only; other providers UNVERIFIED.
- Retries: pi-ai owns them. The OpenAI decisions path uses `NO_RETRY_STATUSES`. The llama.cpp path uses `maxRetries: 2`, bounded by the signal.
- Concurrency: F2. Also, inflight eviction at 128 keys (`decide.ts:203`) can start a duplicate call. Requires 129 concurrent distinct keys; not measured.
- Prompt injection from `input`: `input` goes in as structured `state.input` (`decide.ts:226`), not spliced into instructions. `question` and criteria are model-authored instructions. The output is advisory. No in-repo code consumes `decide` results as a permission gate (grep for `createDecideTool`/`decide` consumers outside the slice: none).

## Seams

- `decide.ts:68` `createDecideTool()`: the only public entry used by `index.ts:4`.
- `decide.ts:438` `defaultDecide`: internal; single caller `decide.ts:223`.
- `config.ts:83` `loadDecideConfig(agentDir, onDiagnostic?)`: used by `index.ts:8` and `decide.ts:178`.
- `packages/core/src/session-cache.ts:62` `getSessionCache`: shared with other extensions; the seam is correct.
- Host usage seam: `agent-session.js:3466-3469` sums toolResult usage. Consumers beyond that sum UNVERIFIED.
- No duplicate classify seam. Nothing outside `extensions/pi-decide` calls `registry.classify` (grep over `extensions/**/*.ts`). The "duplicate seam vs pi-question or pi-memory" lens item has no evidence.

## Rejected defaults

- Re-reading config per call (`decide.ts:178`): the file is small and picks up edits. No measured cost. Rejected.
- SHA-256 over full `input` for the key (`decide.ts:205`): one hash per call, against a model round trip. Rejected as a micro-optimization.
- Outer `Promise.race` timer: `requestSignal` already reaches the provider. Add one only if UNVERIFIED provider behavior is shown.
- Removing the cache or dedupe: required by R26/D91 (`artifacts/review/pi-decide.md` overengineering table).
- Adding retries in decide: pi-ai owns retry and the signal bounds it.
- Input-injection hardening in decide: structured `state.input` plus advisory use is the current design. Do not use decide output as an authorization decision.

## Open Questions

1. Does the host always pass a non-undefined `signal` to `execute`? Decides the severity of F4.
2. Which host surfaces read `getSessionStats` totals? Sizes the impact of F1.
3. Do all pi-ai classifier providers pass `signal` to fetch? Needed to confirm the timeout bound.
4. Should decide spend count against the pi-usage budget cap? Policy decision; see cross-slice note.

## Verdict

Needs fixes before usage totals are relied on. No prior Resolution regressed (0 of 11). Commit `6dd8d6e` correctly reports usage on the first call, but cache hits and joined calls report it again (F1). F2 and F3 are medium and independent of that commit. F4-F9 are low.
