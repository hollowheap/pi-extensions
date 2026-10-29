# pi-subagents Review

## Public Seams

- `index.ts:8-17` — `SubagentStateEventItem`, `createSubagentsExtension`; emits `subagents:state`.
- `agents.ts:7-30,124` — `AgentConfig`, discovery types, `discoverAgents`.
- `config.ts:6-95` — `SubagentsConfig`, `loadSubagentsConfig`.
- `state.ts:6-119` — `SubagentStatus`/`SubagentState`, `SubagentStore`, `subagentsDir`, `requireTrustedProject`.
- `runner.ts:14-244` — `StartSubagentOptions` + `start/attach/send/abort/wait/reconcile/list/readLog`.
- `tool.ts:28-152` — `SubagentToolDeps`, `createSubagentTool`.
- `socket.ts:5-48` — `RunnerRequestOptions`, `runnerRequest`, `waitForRunner`.
- `swap.ts:3-139` — `ModelInfo`, `ModelResolutionContext`, `ResolveModelDeps`, model helpers.
- `write-lock.ts:11-161` — `WriteLockOptions`, `acquireWriteLock`, `withWriteLock`.
- `child.ts:11-17` — `ChildLockOptions`, `createChildLockExtension`.

## Robustness Issues

- `agents.ts:111-122` — `findProjectAgentsDir` unwrapped `statSync`; relative `cwd` can loop upward indefinitely.
- `runner.ts:173-187` — `abortSubagent` marks cancelled on socket failure but does not kill runner/child.
- `runner.ts:209-233` — `reconcileSubagent` uses `existsSync` socket check, not connectability.
- `state.ts:93-102` — `SubagentStore.update` is non-atomic read-modify-write.
- `child.ts:41-65` — write-lock acquisition can throw/timeout without handling; leaked locks rely on 10m timer.
- `child.ts:55-65` — locks released only on `tool_result`; cancelled/errored calls wait for hold timeout.
- `runner-shim.ts:134-153` — child stream errors and failed state writes are unhandled.
- `index.ts:39-69` — ticker interval callback has no error guard.
- `config.ts:101-105` — unreadable existing config silently falls back to defaults.

## Overengineering

- `tool.ts:28-58` — `SubagentToolDeps` injection layer mainly test scaffolding.
- `swap.ts:8-139` — elaborate runtime model discovery and UI replacement flow.
- `write-lock.ts:54-74` — stale-lock recovery with process start times.
- `runner-shim.ts:1-158` — runner implemented as a string executed with `node -e`.