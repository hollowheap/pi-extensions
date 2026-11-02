# Review — pi-subagents (V11)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`

Status (2026-10-30): robustness, verified bugs, and both overengineering items
fixed. `runner-shim` moved from an embedded string to `runner-shim.mjs`, and
the `SubagentToolDeps` injection layer was removed.


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

- `index.ts:8-17` — `SubagentStateEventItem`, `createSubagentsExtension`; emits `subagents:state`.
- `agents.ts:7-30,124` — `AgentConfig`, discovery types, `discoverAgents`.
- `config.ts:6-95` — `SubagentsConfig`, `loadSubagentsConfig`.
- `state.ts:6-119` — `SubagentStatus`/`SubagentState`, `SubagentStore`, `subagentsDir`, `requireTrustedProject`.
- `runner.ts:14-244` — `StartSubagentOptions` + `start/attach/send/abort/wait/reconcile/list/readLog`.
- `tool.ts:123` — `createSubagentTool(options)` with an optional state-change callback.
- `socket.ts:5-48` — `RunnerRequestOptions`, `runnerRequest`, `waitForRunner`.
- `swap.ts:3-139` — `ModelInfo`, `ModelResolutionContext`, `ResolveModelDeps`, model helpers.
- `write-lock.ts:11-161` — `WriteLockOptions`, `acquireWriteLock`, `withWriteLock`.
- `child.ts:11-17` — `ChildLockOptions`, `createChildLockExtension`.

### Robustness Issues

- `agents.ts:111-122` — `findProjectAgentsDir` unwrapped `statSync`; relative `cwd` can loop upward indefinitely.
- `runner.ts:173-187` — `abortSubagent` marks cancelled on socket failure but does not kill runner/child.
- `runner.ts:209-233` — `reconcileSubagent` uses `existsSync` socket check, not connectability.
- `state.ts:93-102` — `SubagentStore.update` is non-atomic read-modify-write.
- `child.ts:41-65` — write-lock acquisition can throw/timeout without handling; leaked locks rely on 10m timer.
- `child.ts:55-65` — locks released only on `tool_result`; cancelled/errored calls wait for hold timeout.
- `runner-shim.ts:134-153` — child stream errors and failed state writes are unhandled.
- `index.ts:39-69` — ticker interval callback has no error guard.
- `config.ts:101-105` — unreadable existing config silently falls back to defaults.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `tool.ts:28-58` — `SubagentToolDeps` injection layer. | R30, D96 | **Fixed.** Removed; the tool imports its collaborators directly and tests mock the modules. |
| `swap.ts:8-139` — elaborate runtime model discovery and UI replacement flow. | R41, D113 | **Required, not overengineering.** R41/D113 require failing subagent models to query runtime models and prompt `ctx.ui.select` while blocking caller overrides. The discovery and replacement flow is that requirement. |
| `write-lock.ts:54-74` — stale-lock recovery with process start times. | R31, D98 | **Required, not overengineering.** R31/D98 require one writer at a time, stale-lock recovery, and start-time ownership. The recovery path is explicitly specified. |
| `runner-shim.ts:1-158` — runner implemented as a string executed with `node -e`. | R35, D103, D104 | **Fixed.** The runner is now a normal `runner-shim.mjs` asset spawned by path. |

### Verified Bugs (2026-10-29)

Probe: `artifacts/scripts/probe-subagents-lifecycle.ts`. All findings below
were fixed on 2026-10-30; the table is kept as the original evidence.

| Severity | Finding | Evidence |
| --- | --- | --- |
| High | Startup race. `state.socket` is set before the runner listens (`runner.ts:80-88`, `runner-shim.ts:154-157`). `reconcileSubagent` treats a missing socket as failure even while the PID is alive (`runner.ts:214-233`). The 1 s ticker calls `listSubagents`, which reconciles (`index.ts:53-60`). | Probe prints `RECONCILED_STARTING_STATUS= failed`. |
| High | Abort leaves a live child. When the socket is missing or unreachable, `abortSubagent` writes `cancelled` without killing the process (`runner.ts:182-187`). | Probe prints `ABORT_STATUS= cancelled`, `ABORT_PROCESS_ALIVE= true`. |
| Medium | `reconcileSubagent` uses `existsSync` on the socket (`runner.ts:209-212`), not connectability. A stale socket file keeps a dead runner "running" when the PID check is unavailable. | Code read; `isSocketConnectable` already exists in `@hollowheap/process`. |
| Medium | PID reuse. `isProcessAlive(state.pid)` ignores `state.startTime` (`runner.ts:220`) even though the helper accepts an expected start time (`packages/process/src/process.ts:50`). | Code read. |
| Medium | State updates are non-atomic read-modify-write in both host (`state.ts:93-102`) and runner (`runner-shim.ts:33-39`). A completion can be overwritten by a concurrent cancel. | Code read. |
| Medium | `startSubagent` writes state and runner config, then spawns outside a `try` (`runner.ts:97-115`). A spawn/write throw leaves status `starting` forever. | Code read. |
| Medium | The runner writes `child.stdin` after only a `writable` check (`runner-shim.ts:82-88`). An EPIPE race has no `error` handler and can crash the runner before `finish()` persists status. | Code read. |
| Low | Runner SIGTERM handler kills the child but has no SIGKILL escalation (`runner-shim.ts:141-148`); only the socket `abort` action escalates. | Code read. |
| Low | `<id>.runner.json` contains the child environment and is never deleted (`runner.ts:97-108`). Secrets persist on disk with mode 0600. | Code read. |
| Low | The 2 s startup deadline (`runner.ts:118`) is tight under load; `waitForRunner` polls every 25 ms with 200 ms requests (`socket.ts:30-47`). | Code read. |

### Verification

```bash
npx vitest run extensions/pi-subagents/src
npm test
npm run typecheck
npm run lint
```

All pass (58 subagent tests; 892 repository tests).

### Upstream Comparison

`pi-subagents@0.84.0` has foreground in-process children, detached background
runs, fleet UI, workflows, cost accounting, and a documented RPC seam. It does
not emit our `subagents:state`; adopting it requires an event adapter. It is
also 2.5 MB with several dependencies. See
`artifacts/research/pi-extension-landscape.md`.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
