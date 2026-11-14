# Review — pi-tasks robustness re-review (V31)

## Scope

- Slice: `extensions/pi-tasks/src/` plus `shim.cjs`, README, and the runtime seams it calls (`packages/runtime/src/{lifecycle,process,store,state}.ts`, `packages/core/src/{alerts,workspace}.ts`). About 1053 LOC in the slice.
- Prior reviews: `artifacts/review/pi-tasks.md` (V12) and V17 pi-tasks rows in `artifacts/review/ui-upgrades.md`.
- Recent commits: `86db9f1` (alert ticker starts after session start), `83e9c97`, `a6284e8`, `ed74637`.
- Out of scope: the uncommitted `extensions/pi-agent` fix. Runtime items F1 to F7 from V21 are covered only under Cross-slice impact.
- Method: source reads with line numbers, host code in `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`, and `npx vitest run extensions/pi-tasks/src/runner.test.ts` (6/6 pass). Probes ran in `/tmp/v31`, which was deleted afterward. No repo file was edited.
- Probes ran the real `shim.cjs` under `node -e`, the real `runner.ts`/`registry.ts`/`alerts.ts`/`workspace.ts` through jiti, and the pi-tui `Markdown` renderer.

## Prior resolutions

V12 Robustness Issues, each at HEAD:

- Spawn failure marks task failed before rethrow: holds (`runner.ts:104-111`).
- Start-time identity captured for new tasks: holds (`shim.cjs:59-63`, parent patch `packages/runtime/src/lifecycle.ts:28-35`).
- `cancelTask` keeps task running while process is alive after grace: holds (`runner.ts:165-170`). Its outcome is wrong in another way, see V31-F1.
- 5 s startup grace before missing PID reconciles to failed: holds (`runner.ts:25,35-36`).
- Reconcile re-reads under lock via `updateIf`: holds (`runner.ts:38-42`, `packages/runtime/src/store.ts:89-106`).
- `readTaskMetadata`/`listTaskMetadata` validate shape: holds (`registry.ts:55-87`).
- Dependency cycles checked before start: holds (`task-tool.ts:273-280`), but unreachable, see V31-F12.
- Cancelled dependencies block start: holds (`task-tool.ts:293-307`).
- `list` emits running entries via `onTasksChange`: holds (`task-tool.ts:345-357`).
- `readProcStartTime` `ps` fallback: holds in runtime (`packages/runtime/src/process.ts:47-62`); pi-tasks re-exports it at `runner.ts:6`.
- `session_start` catches storage failures and warns: holds (`index.ts:173-189`).
- Spawn patches PID after shim start and keeps terminal status: holds (`lifecycle.ts:36-40` patch omits `status`; `shim.cjs:34` guard).

V12 Overengineering Audit (2026-11-04):

- `TaskKind` is `"shell"` only: holds (`registry.ts:6`). README still documents `"shell" | "subagent"`, see V31-F14.
- `TaskOperations` removed: holds (no match in `extensions/pi-tasks/src`).
- `runnerOps` removed: holds (no match in `extensions/pi-tasks/src`).
- `TaskToolDeps` fully required: holds (`task-tool.ts:38-44`).
- Shim moved to `shim.cjs`: holds (`runner.ts:20-23`).

V17 pi-tasks rows (`ui-upgrades.md:52,62`):

- Scrollable Markdown pager: holds (`index.ts:6,36-44`). The pager renders raw task output, see V31-F5.
- Clipboard/prompt insertion for tasks: not implemented. No `pasteToEditor`/`setEditorText` in `extensions/pi-tasks/src`. This row is an idea, not a resolution.

Regressed prior resolutions: 0 in code.

Ticker commit `86db9f1` (checked as asked):

- Stop on shutdown: holds (`index.ts:193-196`).
- Stop on `/reload`: holds. Host emits `session_shutdown` with the old runner before `session_start` (`agent-session.js:3001,3028`).
- Stop on session replacement: holds (`agent-session-runtime.js:106,297`).
- No duplicate ticker: holds (`index.ts:111,120` guard per closure; `unref` at `index.ts:130`).
- Ticker does not redraw status: holds (`index.ts:121-129` calls observe and cleanup only).

## Cross-slice impact (V21, packages/runtime)

- F1 stale-lock break: pi-tasks takes the lock in `runner.ts:38` and `runner.ts:173`, hold times in ms. Impact needs a holder stall above 2 s, which pi-tasks does not produce. Not mitigated but not reached. Mitigation: none needed in practice.
- F2 timeout/abort kills only the direct child: pi-tasks uses no timeout kill. Cancel signals the group while the leader is alive (`process.ts:179`), so grandchildren die on `cancel` in that case. Not mitigated after the shell exits, see V31-F2.
- F4 `cancelProcessGroup` skips the group when the leader is gone: pi-tasks has the same gate at `runner.ts:165`. Effect: a shell that exits leaves a live group that `cancel` cannot reach, which is V31-F2. Unmitigated.
- F5 zombie counts as alive: pi-tasks keeps a task `running` when the shim is an unreaped zombie (`runner.ts:37,167-168`). Reachable only with a non-reaping PID 1. UNVERIFIED in the user environment.
- F7 `readLog` returns `""` for huge logs: pi-tasks shows `(no output)` for `status`, `wait`, and `/task logs` (`task-tool.ts:124`, `index.ts:38`). Silent misreport for logs above the V8 string limit. Unmitigated. Path: `registry.ts:81-83` to `process.ts:114-121`.

## Findings

### V31-F1 — medium — Robustness (cancel outcome, exit signals)

- Current: `shim.cjs:93-95` `const exitCode = typeof code === "number" ? code : null; const status = exitCode === 0 ? "completed" : "failed";` and `runner.ts:173-178` writes `cancelled` only through `updateIf(status === "running")`.
- Gap: a shell killed by SIGTERM reports `code === null`, so the shim writes `failed` first. `cancelTask` then sees a non-running record and returns `failed`. Signal info is dropped.
- Failure: `cancel` on any task that has started returns `status: failed`, `exitCode: null`. The README promises `cancelled`. Test `runner.test.ts:154-166` passes (6/6 run), but it cancels immediately. Inferred from probe p3: a SIGTERM that arrives before the shim installs its handler kills the shim, so the test does not reach the `failed` path.
- Reproduction (observed): meta `{status:"running"}`, spawn `node -e <shim.cjs> meta log dir /bin/sh "sleep 30"` detached, wait for `pid` in meta, wait 200 ms, `kill(-pid,"SIGTERM")`, poll 250 ms. Result: `status:"failed", exitCode:null`. Same with `"sleep 30; echo done"`, and with a 300 ms delay.
- Fix: record a cancel request in state before signalling (`cancelRequested: true` via `updateIf`). In the shim `close` handler, write `cancelled` when that flag is set. Keep the terminal-state guard at `shim.cjs:34`. Add a test that cancels after the shell starts.
- Confidence: high (observed).

### V31-F2 — high — Robustness (cancel whole tree, reconciliation)

- Current: `shim.cjs:89-96` on child `close` writes the terminal status and calls `process.exit(0)`. `runner.ts:161-163` returns a non-running task unchanged, so `cancel` is a no-op on it.
- Gap: the shim is the process-group leader. When the shell exits, the shim exits and the group survives. Nothing records or signals the survivors.
- Failure: `sleep 300 &` style background children keep running and writing to the log after the task reports `completed`. `cancel` cannot reach them. This is the group-kill gap from V21-F4 in its common form.
- Reproduction (observed): meta `{status:"running"}`, spawn the shim with `sh -c "sleep 300 & echo bg=$!"`, wait 800 ms. Meta shows `status:"completed", exitCode:0`. The grandchild PID from the log is alive (`kill -0` succeeds). The probe then killed it.
- Fix: before the shim exits, signal the group (`process.kill(-process.pid, "SIGTERM")` with a grace and SIGKILL), or keep the group leader alive until the group is empty. Report survivors in the status detail. Add a test with a background child.
- Confidence: high (observed).

### V31-F3 — medium — Robustness/Requirements (dependency semantics)

- Current: `task-tool.ts:286-292` returns `Waiting for dependencies: ...` and does not start the task.
- Gap: R52 acceptance (`artifacts/requirements.md:277`) says task B "waits for A to finish before starting". The code refuses instead. No test covers the branch (grep for `Waiting for dependencies` in tests: none).
- Failure: the model must poll and resubmit. A dependent task is never queued, so a chain can stall if the model stops polling.
- Reproduction (code trace, not executed): start A with `sleep 30`; call `start` with `dependsOn:[A]`. Expected under R52: B is queued. Actual: `Waiting for dependencies: A`, and no `task-*.json` for B is written.
- Fix: decide the contract first (Open Question 2). If R52 stands, queue B in state and have the ticker start it when A is terminal and completed. Otherwise amend R52 and README.
- Confidence: high on code; reproduction not executed.

### V31-F4 — medium — Robustness (state and workspace cleanup)

- Current: `workspace.ts:49-58` keeps tracked isolated workspaces in an in-memory `Map`. `index.ts:125` cleans them only from the ticker, and the ticker is stopped at shutdown (`index.ts:194`).
- Gap: nothing persists the isolated workspace path. After a restart, or after a task finishes during shutdown, the directory is never removed.
- Failure: each `isolated:true` task that outlives its pi session leaves a directory under the root. Disk use grows with no bound.
- Reproduction (observed): `allocateTaskWorkspace({enabled:true})`, `track` on tracker 1, then a fresh tracker 2 runs `cleanupTerminal([{id, status:"completed"}])`. The directory still exists.
- Fix: on `session_start`, scan task metadata for terminal tasks with `isolated` set and remove their workspace. Persist the workspace path in the task JSON so the scan works without the in-memory map.
- Confidence: high (observed).

### V31-F5 — medium — UI (terminal control bytes, pager)

- Current: `index.ts:36-43` passes raw log text into `~~~~text` fenced Markdown for `showMarkdownPager`. Picker descriptions at `index.ts:55` also carry raw `task.command`.
- Gap: no escaping of control bytes anywhere in the path (`index.ts`, `packages/tui/src/pager.ts:22-90`).
- Failure: task output can move the cursor, set the window title (OSC 0), or send other OSC sequences to the terminal. OSC 52 (clipboard write) is UNVERIFIED in the user terminal. A line `~~~~` in the log closes the fence early under CommonMark, so later lines render as Markdown (rendering not checked).
- Reproduction (observed): `new Markdown("~~~~text\n" + log + "\n~~~~", 0, 0, identityTheme).render(w)` with `log` containing `\x1b[2J` and `\x1b]0;pwned\x07`. Output keeps both sequences at widths 40, 80, and 200. Widths hold: no line exceeds `w` visible columns.
- Fix: strip or escape C0/C1 controls and ESC except newline and tab before rendering. Use a fence longer than any run of tildes in the log. Escape picker labels the same way.
- Confidence: high for the pager bytes (observed); UNVERIFIED for the picker and terminal effects.

### V31-F6 — low — Performance (ticker over history)

- Current: `index.ts:121-129` runs `reconcileAllTasks` every 1000 ms from `session_start` (`index.ts:190`). `reconcileAllTasks` reads every task JSON (`runner.ts:49-57`, `state.ts:109-121`), and `reconcileTask` reads each one again (`runner.ts:32`).
- Gap: cost follows total task history, not running tasks. No task is ever deleted.
- Failure: measured `reconcileAllTasks` cost per tick with all tasks completed: 2.6 ms at 100 tasks, 31 ms at 1000 tasks (50 repetitions, Node 24.21 via jiti). That is 3% of a core at 1000 tasks, every second.
- Reproduction (observed): seed N completed `*.json` files under `<agentDir>/tasks`, time `reconcileAllTasks(agentDir)` over 50 calls.
- Fix: keep a set of non-terminal IDs in the ticker and read only those. Optional retention. Measure again before changing anything else.
- Confidence: high (measured); impact is low at realistic history sizes.

### V31-F7 — low — Performance (log reads per call)

- Current: `task-tool.ts:383,425,443` and `index.ts:37` call `readTaskLog`, which reads the whole file (`registry.ts:81-83` to `process.ts:114-121`). Only 4000 characters are kept (`task-tool.ts:124`, `format.ts:3-11`).
- Gap: full read and copy to keep 4000 characters.
- Failure: measured 193 ms and a 94 MB string per `status` call. Above the V8 string limit the result is `""` (V21-F7), so the model is told `(no output)`.
- Reproduction (observed): write a 94 MB log, time `readTaskLog`.
- Fix: read only the head and tail with `fs.read` at offsets. Keep the call shape. Add a test with a log above 512 MB or a stubbed size.
- Confidence: high for the timing; the silent `(no output)` is high (code trace, V21-F7 observed).

### V31-F8 — low — Backend (bounded output to the model)

- Current: `task-tool.ts:129-141` joins every task in `formatTaskList`, and `task-tool.ts:345-361` returns it. Nothing deletes task files (grep: no `unlink`/`rm` under `extensions/pi-tasks/src`).
- Gap: the `list` result has no cap or count, and the picker has no "showing N of M" note.
- Failure: output grows by one line per task forever. Size per line is about 100 characters. UNVERIFIED size at 1000 tasks (not measured).
- Fix: cap `list` at N most recent with a `(+K more)` line. Pair with V31-F6 retention.
- Confidence: medium (code trace).

### V31-F9 — low — Robustness (completion alerts once)

- Current: `alerts.ts:14-16` keeps `previous` and `dispatcher` per tracker instance. `core/alerts.ts:84-95` dedupes with a `seen` set per dispatcher.
- Gap: dedupe does not cross processes. Two pi sessions on the same `agentDir` each alert.
- Failure: observed two deliveries for one completion (two trackers, `observe` on the same transition).
- Reproduction (observed): two `TaskAlertTracker` instances seeded `running`, both observe `completed` with a notify stub. Two alerts.
- Fix: a per-task marker file (`<id>.alerted`, created with `wx`) or a lock. Decide first whether alerts are per session or per task (Open Question 1).
- Confidence: high (observed).

### V31-F10 — low — Robustness (lost cancel write)

- Current: the shim updates state without the store lock (`shim.cjs:31-46`: read, merge, `renameSync`). The parent uses `updateIf` under the lock (`store.ts:89-106`).
- Gap: a locked write between the shim's read and rename is overwritten.
- Failure: a cancel write can be replaced by `completed`. Narrow window, since `cancelTask` writes only after the process is gone (`runner.ts:167`).
- Reproduction (observed): read the meta as the shim would, run `updateIf(...status:"cancelled")`, then rename the shim's merged copy. Final status: `completed`.
- Fix: take the same `.lock` file in the shim (plain `wx` create and unlink), or let the shim write only through a single-writer path.
- Confidence: high for the interleaving; real-world rate UNVERIFIED.

### V31-F11 — low — UI/Requirements (tailing a growing log)

- Current: `index.ts:36-44` reads the log once and opens a pager over that string. `pager.ts` takes fixed `markdown`.
- Gap: R52 says running output is "tail-able via `/task logs <id>`" (`requirements.md:277`). The view is a snapshot and never refreshes.
- Failure: a running task shows stale output until the user runs the command again.
- Reproduction (code trace): call `/task logs <id>` on a running task, append to its log, the overlay does not change.
- Fix: re-read on a timer while the pager is open, or document snapshot behavior and amend R52.
- Confidence: high (code trace).

### V31-F12 — low — Simplicity (dead code, speculative options)

- `task-tool.ts:68-100` `findDependencyCycle` and `task-tool.ts:273-280` caller. Deletion test: a dependency can only name IDs that existed at start (`task-tool.ts:264-271`). A new task gets a fresh ID (`task-tool.ts:311`). No later task can close a cycle. Removing the code changes no reachable behavior.
- `registry.ts:51-53` `writeTaskMetadata`, `registry.ts:96-104` `createTaskRecord`, `registry.ts:31-33` `tasksDir`, `workspace.ts:34-39` `integrateTaskWorkspace`: no production caller, tests only (grep).
- `index.ts:21-24` `TaskStore` alias "for compatibility": no importer in repo.
- `workspace.ts:51-55` `cleanup` constructor parameter: only the default is used.
- Confidence: high (grep and trace).

### V31-F13 — low — Robustness (startup-grace flip) — UNVERIFIED

- Current: `runner.ts:35-44` marks a task failed when `pid` is missing after 5 s. The shim writes `pid` later (`shim.cjs:60-63`) without clearing `failed`, and `close` then overwrites with `completed` or `failed`.
- Gap: a shim slower than 5 s is reported `failed` while it runs.
- Failure: a status of `failed` on a live task. UNVERIFIED: needs a 5 s stall during shim start.
- Fix: keep `running` until the shim has been seen dead, or reconcile only from the PID check.

### V31-F14 — low — Docs drift

- `README.md` line 27: `kind: "shell" | "subagent"`, while `registry.ts:6` is `"shell"` only (V12 resolution).
- README says `TaskStore` is re-exported "for compatibility" (`README.md`, Shared lifecycle primitives). No consumer (see V31-F12).
- Confidence: high.

## Failure modes

- Pi crashes while a shell runs: state stays `running`, reconcile on restart resolves by PID and start time. Holds.
- Cancel during shim startup: the shim dies before its handler, state stays `running`, and `cancelTask` writes `cancelled` after SIGKILL (probe: shim dead at 250 ms, meta still `running`). Correct outcome, by accident.
- Cancel after the shell starts: `failed`, `exitCode:null` (V31-F1).
- Shell exits with background children: `completed`, children alive, cancel no-op (V31-F2).
- Isolated task outlives its session: directory never removed (V31-F4).
- Log above the V8 string limit: `(no output)` (V21-F7 through `task-tool.ts:124`).

## Seams

- pi-tasks to runtime: `lifecycle.ts` (`spawnDetachedTask`), `process.ts` (`isProcessAlive`, `cancelProcessGroup`, `readLog`), `store.ts` (`updateIf`, `list`). This is a clean seam.
- The shim duplicates `readStartTime` (`shim.cjs:15-29` vs `process.ts:47-62`) and atomic write (`shim.cjs:31-46` vs `state.ts:78-91`). Required because the shim is plain CJS (`requirements.md:349`). Accepted, but see V31-F10.
- pi-subagents imports the runtime directly (`extensions/pi-subagents/src/runner.ts:5`). It does not import pi-tasks. `requirements.md:349` says pi-subagents depends on pi-tasks, which is not true at HEAD. Two spawn seams exist in practice (UNVERIFIED whether pi-subagents embeds its own shim).
- `index.ts` re-exports `*` from runtime, tui, and pi-tasks modules. Name collisions drop silently in ES star exports. UNVERIFIED for current names.

## Rejected defaults

- 1000 ms ticker: keeps alert latency low and costs 2.6 ms per tick at 100 tasks. Keep (V31-F6 covers growth).
- 250 ms cancel grace (`runner.ts:157`): adequate for shells that handle SIGTERM. Keep.
- 40 ms wait poll (`runner.ts:150`): cost is one small JSON read per poll. No measurement shows a problem. Keep.
- 4000-character output cap (`format.ts:3-5`): bounded and correct for the model. Keep.
- 30 s default wait, 600 s max (`task-tool.ts:168-175`): reasonable. Keep.

## Open Questions

1. Should a task that finished while pi was closed alert on the next start? Today `session_start` seeds it as already terminal, so no alert fires (`index.ts:173-176`). Decides V31-F9.
2. Should `dependsOn` queue the task (R52 wording) or refuse it (current code)? Decides V31-F3.
3. Is task history retention wanted? README says cleanup is manual. Decides V31-F6 and V31-F8.
4. Should pager output show control bytes? Decides V31-F5.
5. Does pi-subagents need to depend on pi-tasks (`requirements.md:349`), or is that text stale?

## Verdict

Needs changes. One high finding (V31-F2) and four medium findings (V31-F1, V31-F3, V31-F4, V31-F5). Zero regressed prior resolutions in code. The cancel and cleanup contracts do not hold on the common path: `cancel` reports `failed` (V31-F1), orphaned children survive `completed` (V31-F2), and isolated workspaces leak across restarts (V31-F4).
