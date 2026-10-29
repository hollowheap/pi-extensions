# pi-classifier Review

## Public Seams

- `decide.ts:61` — `createDecideTool(overrides?: Partial<DecideDeps>)`.
- `decide.ts:323` — `defaultClassify(ctx, modelId, input, signal)`.
- `decide.ts:59` — `decideTool` singleton.
- `decide.ts:13-38` — `DecideKind`, `DecideLabel`, `DecideParams`, `DecideDeps`.
- `config.ts:4` — `CONFIG_FILE_NAME`, `:6` `ClassifierConfig`, `:80` `loadClassifierConfig(agentDir, onDiagnostic?)`.
- `index.ts:6` — default extension factory.

## Robustness Issues

- Caller abort not forwarded to classifier: `decide.ts:148` creates only `AbortSignal.timeout(config.timeoutMs)`; cancelled caller leaves request running.
- Mid-flight aborted calls can still populate cache: `decide.ts:190-198` caches whenever `result.details.error === undefined`, even if caller aborted.
- `index.ts:24` calls `ctx.ui.notify(...)` without guarding `ctx.ui`.
- `config.ts:86-97` treats every `readFileSync` failure as "file missing" with no diagnostic.
- Cache is unbounded `Map` (`decide.ts:63-66`).
- `stableStringify` embeds full `input` in key (`decide.ts:131-137`), large key strings for 100k-char inputs.
- Validation ordering: `decide.ts:123-129` returns validation error before `signal?.aborted` check.
- `normalize` (`decide.ts:276-308`) does not verify returned `choice`/`score` is one of caller-supplied labels.
- `defaultClassify` (`decide.ts:343`) accesses `ctx.modelRegistry` without guard.

## Overengineering

- `stableStringify` (`decide.ts:40-51`) reimplements sorted-key serialization.
- `decideTool` singleton (`decide.ts:59`) uses unusable default deps (`getAgentDir` returns `"/nonexistent-pi-agent-dir-for-tests"`).
- Injection layer (`DecideDeps`, `defaultDeps`, `Partial` overrides, `:29-62`) plus per-instance cache/inflight machinery substantial relative to single tool.