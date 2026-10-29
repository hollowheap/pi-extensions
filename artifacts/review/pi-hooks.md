# pi-hooks Review

## Public Seams

- Deep imports: `config.ts` (`HookEntry`, `HookConfig`, `LoadHooksOptions`, `loadHooks`) and `hooks.ts` (`HookPayload`, `SessionHookPayload`, `PreVerdict`, `PostHookResult`, `SessionHookResult`, `evaluateCondition`, `matchesTool`, `runPreHook`, `runPostHook`, `runSessionHook`, `interpretPreHook`).
- Config file seam: `loadHooks` merges `<agentDir>/hooks.json` + `<workspaceRoot>/.pi/hooks.json` based on `trusted`.
- Event-handler seams: `session_start`, `tool_call`, `tool_result`.
- Command protocol seam: JSON on stdin and pre-hook decisions.
- Skill discovery seam: gated by `PI_HOOKS_DISCOVER_SKILL=1`.

## Robustness Issues

- `hooks.ts:44-49` — `evaluateCondition` regexes use `\\s` in regex literals, matching literal backslash-s; every condition evaluates to `true` (fail-open).
- `index.ts:47` — `event.input as Record<string, unknown>` unsafe cast; non-object input becomes `undefined` at runtime.
- `index.ts:121` — `ctx.ui.notify` in post-tool path not guarded; inconsistent with session_start.
- `index.ts:90-92` — `loadContextHooks` and `payloadFor` not wrapped; unexpected failure rejects `tool_call` handler.
- `config.ts:46` — module-global `CACHE` survives across sessions/tests.
- `config.ts:60-63` — diagnostics reported once per cache entry; later callers with different `onDiagnostic` never see them.
- `index.ts:114-133` — `previousOutput` leaks into chained successors; failed hook leaves stale previous output.

## Overengineering

- `hooks.ts:37-55` — mini condition language plus `evaluateCondition` is premature generalization; untested and broken.
- `config.ts:37-42` + `:56-63` — mtime-keyed cache with `reported` flag and per-entry diagnostics.
- `hooks.ts:23-35` + `interpretPreHook` — exported types and interpreter expose implementation details.