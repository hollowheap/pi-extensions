# Review — pi-tasks (V12)

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

- `index.ts:10-12` — re-exports `registry`, `runner`, `task-tool` modules.
- `registry.ts:5-26` — exports `TaskKind`, `TaskStatus`, `TaskMetadata`, `TaskRecord`.
- `registry.ts:42-104` — exports `tasksDir`, `ensureTasksDir`, `generateTaskId`, `taskMetaPath`, `taskLogPath`, metadata CRUD, `toTaskRecord`, `createTaskRecord`.
- `runner.ts:108-141,143-261` — exports `reconcileTask`, `reconcileAllTasks`, `spawnShellTask`, `waitForTask`, `cancelTask`, `readProcStartTime`.
- `task-tool.ts:23-39,104` — exports `TaskAction`, `TaskToolParams`, `TaskToolDeps`, `createTaskTool`.
- `index.ts:25-32,37-39` — event seam `tasks:state` (running tasks only) plus statusline key `"tasks"`.

### Robustness Issues

- Resolution (2026-11-01): Spawn failures already mark the created task failed before rethrowing; the review note was stale.
- Resolution (2026-11-01): New tasks always attempt to capture a start-time identity (`/proc` or `ps` fallback); PID-only remains for legacy states or platforms without process-start metadata.
- Resolution (2026-11-01): `cancelTask` leaves the task running when the process remains alive after the grace period.
- Resolution (2026-11-01): New tasks get a 5-second startup grace before missing PIDs are reconciled to failed.
- Resolution (2026-11-01): Reconcile uses `TaskStore.updateIf`, which re-reads under the state lock before patching.
- Resolution (2026-11-01): `readTaskMetadata` and `listTaskMetadata` validate task shape and drop malformed records.
- Resolution (2026-11-01): Dependency cycles are detected with a DFS before a task starts.
- Resolution (2026-11-01): Cancelled dependencies now block `start` with a failed-or-cancelled message.
- Resolution (2026-11-01): `list` now emits running entries through `onTasksChange`.
- Resolution (2026-11-01): `readProcStartTime` falls back to `ps -o lstart=` when `/proc` is unavailable.
- Resolution (2026-11-01): `session_start` catches storage failures and reports a warning instead of rejecting startup.
- Resolution (2026-11-01): Spawn patches PID and start time after the shim starts; terminal status is preserved and the final record carries the PID.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `registry.ts:5` — `TaskKind` includes `"subagent"` although only `"shell"` exists. | R20, D65, D70 | **Fixed (2026-11-04).** `TaskKind` is now `"shell"`; the speculative `"subagent"` literal was removed. |
| `registry.ts:28-36,85-108` — injectable `TaskOperations` and repeated `toTaskRecord` wrapping. | R20, D70 | **Fixed (2026-11-04).** `TaskOperations` was removed; `TaskRecord` keeps metadata plus `output`, and `toTaskRecord` has no dispatch wrapper. |
| `runner.ts:95-106` — `runnerOps` wrapper duplicates function references. | No R/D | **Fixed (2026-11-04).** `runnerOps` was removed; callers use `waitForTask` and `cancelTask` directly. |
| `task-tool.ts:33-39` — `TaskToolDeps` optional callbacks for behavior `index.ts` always supplies. | No R/D | **Fixed (2026-11-04).** `TaskToolDeps` is now required, including `getAgentDir` and both callbacks. |
| `registry.ts:19` plus `task-tool.ts:216-255` — dependency graph support exists only for shell tasks. | R52, D124 | **Required, not overengineering.** R52/D124 explicitly require task B to declare a dependency on task A and wait. Shell is the only implemented task kind, so the scope matches the requirement. |
| `runner.ts:21-93` — large `SHIM_SCRIPT` string embedded instead of a separate asset. | R20, D69 | **Fixed (2026-11-04).** The shim moved to `src/shim.cjs` and is read with `readFileSync(new URL(...))`; the embedded string was removed. |

### Resolution (2026-11-04)

- Removed `TaskOperations`, `runnerOps`, and the wait/cancel closures from `TaskRecord`; callers use `waitForTask` and `cancelTask` directly.
- Moved the detached runner script to `src/shim.cjs`.
- Made `TaskToolDeps` fully required.
- Narrowed `TaskKind` to `"shell"`.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — overengineering findings resolved.
