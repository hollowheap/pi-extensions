# pi-tasks Review

## Public Seams

- `index.ts:10-12` — re-exports `registry`, `runner`, `task-tool` modules.
- `registry.ts:5-26` — exports `TaskKind`, `TaskStatus`, `TaskMetadata`, `TaskRecord`, `TaskOperations`.
- `registry.ts:42-121` — exports `tasksDir`, `ensureTasksDir`, `generateTaskId`, `taskMetaPath`, `taskLogPath`, metadata CRUD, `toTaskRecord`, `createTaskRecord`.
- `runner.ts:108-141,143-261` — exports `reconcileTask`, `reconcileAllTasks`, `spawnShellTask`, `waitForTask`, `cancelTask`, `readProcStartTime`.
- `task-tool.ts:23-39,104` — exports `TaskAction`, `TaskToolParams`, `TaskToolDeps`, `createTaskTool`.
- `index.ts:25-32,37-39` — event seam `tasks:state` (running tasks only) plus statusline key `"tasks"`.

## Robustness Issues

- `runner.ts:152-200` — if `spawnDetachedProcess` throws after `createTaskRecord`, metadata stays `running` until reconcile.
- `runner.ts:250` — `isProcessAlive` with undefined `startTime` checks only PID (PID-reuse false positive).
- `runner.ts:259-260` — `cancelTask` writes `cancelled` even if SIGKILL grace period expires.
- `runner.ts:108-131` — reconcile writes full metadata after stale read; can race with shim.
- `registry.ts:66-71,81-83` — `readTaskMetadata` and `listTaskMetadata` cast `ProcessState` to `TaskMetadata` without validation.
- `task-tool.ts:216-255` — dependency handling does not actually detect cycles; cancelled deps treated as eligible.
- `task-tool.ts:277-284` — `list` updates status but does not emit `tasks:state`.
- `runner.ts:33-48` — `readProcStartTime` is Linux-only via `/proc`.
- `index.ts:60-67` — `session_start` performs file IO synchronously without error handling.
- `runner.ts:187-199` — if shim finishes before extension writes `pid`, returned record lacks `pid`.

## Overengineering

- `registry.ts:5` — `TaskKind` includes `"subagent"` although only `"shell"` is implemented.
- `registry.ts:28-36,85-108` — injectable `TaskOperations` and repeated `toTaskRecord` wrapping add indirection.
- `runner.ts:95-106` — `runnerOps` wrapper duplicates function references.
- `task-tool.ts:33-39` — `TaskToolDeps` optional callbacks for behavior index.ts always supplies.
- `registry.ts:19` plus `task-tool.ts:216-255` — dependency graph support exists only for shell tasks.
- `runner.ts:21-93` — large `SHIM_SCRIPT` string embedded instead of separate bundled asset.