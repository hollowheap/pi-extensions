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
- `registry.ts:5-26` — exports `TaskKind`, `TaskStatus`, `TaskMetadata`, `TaskRecord`, `TaskOperations`.
- `registry.ts:42-121` — exports `tasksDir`, `ensureTasksDir`, `generateTaskId`, `taskMetaPath`, `taskLogPath`, metadata CRUD, `toTaskRecord`, `createTaskRecord`.
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
| `registry.ts:5` — `TaskKind` includes `"subagent"` although only `"shell"` exists. | R20, D65, D70 | **Partly required.** D70 requires a generic `kind` field with `shell` as the first kind, so the generic type is required. The literal `"subagent"` has no consumer yet and is speculative until R20 expands beyond shell tasks. |
| `registry.ts:28-36,85-108` — injectable `TaskOperations` and repeated `toTaskRecord` wrapping. | R20, D70 | **Overengineered.** R20/D70 require a task record and operations, not an injectable operations interface. The wrapper is a test seam and repeats the same shape. |
| `runner.ts:95-106` — `runnerOps` wrapper duplicates function references. | No R/D | **Overengineered.** No requirement asks for a second dispatch object; it simply aliases the functions and adds a layer to trace. |
| `task-tool.ts:33-39` — `TaskToolDeps` optional callbacks for behavior `index.ts` always supplies. | No R/D | **Overengineered.** R20 requires the tool actions, not optional dependency callbacks. The production path always supplies them, so this is test scaffolding. |
| `registry.ts:19` plus `task-tool.ts:216-255` — dependency graph support exists only for shell tasks. | R52, D124 | **Required, not overengineering.** R52/D124 explicitly require task B to declare a dependency on task A and wait. Shell is the only implemented task kind, so the scope matches the requirement. |
| `runner.ts:21-93` — large `SHIM_SCRIPT` string embedded instead of a separate asset. | R20, D69 | **Overengineered.** D69 requires a detached runner shim, not that its source be embedded in a TypeScript string. The string makes escaping and error handling harder without a requirement behind it. |

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
