# Review — pi-classifier (V03)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`


## Requirements Review

N/A — package robustness review; traceability is recorded in the Code Review findings.

## Design Review

N/A — package robustness review; see `artifacts/architecture.md`.

## Specification Review

N/A — package robustness review; verify commands are recorded under Code Review.

## Plan Review

N/A — package robustness review; tasks remain in `artifacts/plan.md`.

## Code Review

### Public Seams

- `decide.ts:67` — `createDecideTool()`.
- `decide.ts:437` — `defaultClassify(ctx, modelId, input, signal)`.
- `decide.ts:15-30` — `DecideKind`, `DecideLabel`, `DecideParams`.
- `config.ts:4` — `CONFIG_FILE_NAME`, `:6` `ClassifierConfig`, `:80` `loadClassifierConfig(agentDir, onDiagnostic?)`.
- `index.ts:6` — default extension factory.

### Robustness Issues

- Caller abort not forwarded to classifier: `decide.ts:148` creates only `AbortSignal.timeout(config.timeoutMs)`; cancelled caller leaves request running.
- Mid-flight aborted calls can still populate cache: `decide.ts:190-198` caches whenever `result.details.error === undefined`, even if caller aborted.
- `index.ts:24` calls `ctx.ui.notify(...)` without guarding `ctx.ui`.
- `config.ts:86-97` treats every `readFileSync` failure as "file missing" with no diagnostic.
- Cache is unbounded `Map` (`decide.ts:63-66`).
- `stableStringify` embeds full `input` in key (`decide.ts:131-137`), large key strings for 100k-char inputs.
- Validation ordering: `decide.ts:123-129` returns validation error before `signal?.aborted` check.
- `normalize` (`decide.ts:276-308`) does not verify returned `choice`/`score` is one of caller-supplied labels.
- `defaultClassify` (`decide.ts:343`) accesses `ctx.modelRegistry` without guard.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `decide.ts:40-51` — `stableStringify` reimplements sorted-key serialization. | R26, D91 | **Required, not overengineering.** R26/D91 require a cache key covering model, kind, question, criteria, and input. Sorted serialization is the minimal way to keep that key deterministic across object field order. |
| `decide.ts:59` — `decideTool` singleton uses unusable default deps (`getAgentDir` returns a fake test path). | R27 | **Fixed.** The singleton/default-dependency path was removed; `createDecideTool` now requires explicit dependencies. |
| `decide.ts:29-62` — `DecideDeps`/`defaultDeps`/`Partial` injection plus per-instance cache/inflight. | R26, D91 | **Fixed (2026-11-04).** The cache and in-flight map remain required by R26/D91. The `DecideDeps` injection layer and `Partial` overrides were removed; the tool loads config and calls `defaultClassify` directly. |

### Resolution (2026-10-30)

- Result cache and in-flight dedupe moved to the core session cache with a 128-entry cap.
- Caller abort is forwarded through a shared request; the request aborts when its last waiter cancels.
- Aborted calls are not cached.
- `choice` labels, score ranges, probabilities, and confidence are validated.
- Score results now include the selected label required by R23.
- Config read failures other than `ENOENT` report diagnostics.
- Missing UI and missing model-registry APIs fail safely.
- Fake `getAgentDir` default and unused `decideTool` singleton removed.
- `DecideDeps` remains as a narrow config/classify seam used by tests; it no longer carries fake production state.

### Resolution (2026-11-04)

- Removed `DecideDeps`, `defaultDeps`, and `Partial` overrides. `createDecideTool()` loads the classifier config and calls `defaultClassify` directly.
- Tests now exercise the real config loader through a mocked agent directory and the real `defaultClassify` path through `ctx.modelRegistry`.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — overengineering findings resolved.
