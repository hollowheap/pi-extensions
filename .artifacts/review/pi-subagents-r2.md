# Review — pi-subagents re-review (V24)

## Scope

- Paths: `extensions/pi-subagents/` (src, `child.ts`, `index.ts`, `runner-shim.mjs`), read-only.
- Commit: `a035b03`. Recent commits touching the slice: `a57b263`, `99cd6b5`, `2e31bdb`, `615d205`, `98f1994`, `e68aa50`, `ed74637`, `7654e54`, `a6284e8`, `dd044ed`, `64c6f9f`, `09ba45d`, `7db74bd`, `98b80eb`, `02e5e27`.
- Host peers consulted: `packages/runtime` (process, store, socket), `packages/policy`, `packages/core` (modes, workspace), `node_modules/@earendil-works/pi-agent-core`, `pi-coding-agent`, `pi-tui`.
- Lenses: robustness, UI, backend, performance, simplicity.
- Prior reviews: V11 `artifacts/review/pi-subagents.md`, V18 `artifacts/review/session-definitions.md`.
- Runtime findings from V21 are not repeated. Only the slice's use of runtime is reported.
- Probes ran in `/tmp/probe-r2` and were deleted. No repo file was edited.

## Prior resolutions

Each line gives the verdict at `a035b03`.

- V11 Verified bug, startup race (missing socket during startup): holds. `runner.ts:273` `STARTUP_GRACE_MS = 5_000`, `runner.ts:285-292`.
- V11 Verified bug, abort leaves live child: holds for `running`/`starting`. `runner.ts:233-245` kills runner and child groups. Abort of a state already marked `failed` is a no-op (`runner.ts:225`), see F2.
- V11 Medium, `existsSync` instead of connectability: regressed in effect. The check is now connectability (`runner.ts:288-291`), but it fails a live child, see F2.
- V11 Medium, PID reuse: holds. `runner.ts:281` passes `state.startTime` to `isProcessAlive`.
- V11 Medium, non-atomic read-modify-write: holds. `state.ts:121-127` and `runner-shim.mjs:58-88` use the same `${statePath}.lock` name as `packages/runtime/src/store.ts:95`.
- V11 Medium, spawn outside `try`: holds. `runner.ts:110-160` marks `failed` in the catch.
- V11 Medium, EPIPE crash before status persisted: holds for the crash. `runner-shim.mjs:124-127` handles the error, but its `finish()` now orphans the child, see F1.
- V11 Low, SIGTERM without SIGKILL: holds. `runner-shim.mjs:280-292` escalates after 250 ms.
- V11 Low, `runner.json` env persisted: holds. `runner.ts:166-170` removes the file in `finally`.
- V11 Low, 2 s startup deadline: holds. `runner.ts:147` default is 5 s, and `socket.ts:31-57` polls every 25 ms.
- V11 Robustness, `findProjectAgentsDir` unwrapped `statSync`: holds. `agents.ts:117-130`.
- V11 Robustness, write-lock acquire throw without release: holds. `child.ts:69-72`.
- V11 Robustness, locks released only on `tool_result`: holds. `child.ts:95-97` also releases on `tool_execution_end`. The 10-minute timer is still a gap, see F9.
- V11 Robustness, runner stream errors unhandled: holds. `runner-shim.mjs:128-134` handles stdout and stderr errors, and `update()` catches write errors.
- V11 Robustness, ticker callback unguarded: holds. `index.ts:131-136`.
- V11 Robustness, unreadable config silently defaults: regressed. `config.ts:225-235` records diagnostics, but every caller omits `onDiagnostic` (`tool.ts:449`, `tool.ts:483`, `tool.ts:664`, `child.ts:57`), so the message is never shown. See F14.
- V11 Overengineering, `SubagentToolDeps` removed: holds. `tool.ts:36-41` takes callbacks only.
- V11 Overengineering, runner embedded as a string: holds. `runner.ts:48-50` resolves `runner-shim.mjs`.
- V18 Finding 1, `define` rendered as empty child row: holds. `tool.ts:305-310`.
- V18 Finding 2, branch restore not fail-closed: holds. `index.ts:58-67` and `definitions.ts:43-47`.
- V18 Finding 3, direct `define` assumes string fields (open, not a fix): still open and unchanged. `tool.ts:429-431`. Not re-reported.
- V18 Finding 4, bounds and delete: holds. `tool.ts:408-418` and `tool.ts:449-465`, bounds in `config.ts:36-40`.
- V18 open question, isolated workspace lost on resume: still open. Reported as F8.

Regressed prior resolutions: 2 (V11 connectability, see F2; V11 config diagnostics, see F14).

## Findings

### F1 — orphaned child when the runner fails after spawn

- Severity: high (orphan).
- Lens: robustness.
- Current: `runner-shim.mjs:124-127` (`child.stdin` error calls `finish("failed", null)`), `runner-shim.mjs:297-300` (`server.on("error")` calls `finish("failed", null)`), `runner-shim.mjs:259-270` (`finish()` closes the server and calls `process.exit(0)` after 50 ms). `runner-shim.mjs:117` spawns the child without `detached`, and `finish()` never signals it. Host cleanup `runner.ts:154` calls `cancelProcessGroup(runner.pid, ...)`, which returns early when the runner is dead (`packages/runtime/src/process.ts:178`).
- Gap: a failure path exits the runner while the child keeps running. Nothing kills the child.
- Failure/impact: the child stays alive with state `failed`. `abortSubagent` is a no-op for `failed` (`runner.ts:225`), so the user cannot stop it. The child keeps writing its session and holding write locks until its own timers expire.
- Reproduction: ran `node runner-shim.mjs cfg.json` with `socketPath` of 120+ characters and `command: "sleep"`, `args: ["297"]`. Output: `listen EINVAL: invalid argument ...`, runner exit 0, state `status: "failed"`, and `sleep 297` still alive after the runner exited. The host-side branch (`runner.ts:152-157`) was read, not run.
- Fix: in `finish()` for non-exit failures, send SIGTERM and then SIGKILL to `child` before `process.exit`. In `abortSubagent`, fall back to `state.pid` when the state is `failed` and the pid is alive.
- Confidence: high for the runner path (probed). Host branch: code-read.

### F2 — live child marked `failed` when its socket is unreachable

- Severity: high (lockout, and a second writer on the same session).
- Lens: robustness.
- Current: `runner.ts:280-292`. `childAlive` is computed at `runner.ts:280-281`, but `deadSocket` (`runner.ts:288-291`, `!(await isSocketConnectable(state.socket))`) marks failure on its own: `if (!deadProcess && !missingProcess && !deadSocket) return state;`.
- Gap: socket connectability is not combined with `childAlive`. `isSocketConnectable` uses a 200 ms timeout (`packages/runtime/src/process.ts:188-191`).
- Failure/impact: a live child becomes `failed`. Then:
  - `abortSubagent` returns without acting (`runner.ts:225`), so the child cannot be stopped from the tool or `/subagent pause`.
  - `resume` accepts `failed` (`tool.ts:659`) and starts a second child with the same `--session` file (`tool.ts:693-694`, `tool.ts:725-747`).
  - Two children append to the same session JSONL.
  Trigger: the runner's event loop stalls more than 200 ms, for example in the `sleepSync` lock wait at `runner-shim.mjs:48-81` (up to 1 s), or the socket file is removed.
- Reproduction: ran `reconcileSubagent` and `abortSubagent` through jiti on a `running` state whose pid is a live `sleep 120` and whose socket path does not exist. Output: `reconciled status: failed`, `after abort, status: failed`, `child still alive after abort: true`. The second-writer step is an event sequence, UNVERIFIED by run.
- Fix: `if (!childAlive && deadSocket)` (or treat `deadSocket` as failure only when `!childAlive`). In `resume`, refuse when `state.pid` is alive. In `abortSubagent`, kill `state.pid` for a `failed` state with a live pid.
- Confidence: high for the state change (probed). UNVERIFIED for the two-writer outcome.

### F3 — session definition can raise its child's permission mode

- Severity: high (exposure beyond the user's approval).
- Lens: backend.
- Current: `tool.ts:441-442` stores `agentMode` as `definition.mode` without validation. `tool.ts:541-545` sets `effectiveMode = parentMode && parentMode !== "ask" ? parentMode : (effectiveAgent.mode ?? "ask")`. `tool.ts:568` exports `PI_SUBAGENT_MODE`. `child.ts:35-38` calls `enterMode` with it. `packages/core/src/modes.ts:49-57` builds the `edit` layer, where `edit` is `allow`. `packages/policy/src/extension.ts:69-73` blocks `ask` verdicts with "needs approval (no UI)".
- Gap: when the parent is in `ask`, the definition's `agentMode` replaces the child's mode. `start` is shell-tagged (`packages/policy/src/targets.ts:15`), so the user approves the start by name. The approval does not show the mode.
- Failure/impact: the model defines `writer` with `agentMode: "edit"`, the user approves `start writer`, and the child can write and edit without prompts. The parent's `ask` mode was meant to block that.
- Reproduction: ran `tool.execute` with `define {name:"writer", agentMode:"edit"}`, then `start {agent:"writer"}`, with a stub `PI_BIN` that dumps its env. Output: `define: {"defined":"writer","source":"session"}`, `start: started`, `child env PI_SUBAGENT_MODE=edit`. `enterMode({}, "edit")` returned `{"mode":"edit"}`. The child's policy decision from `modes.ts:49-57` and `extension.ts:69-73` was read, not run in a child.
- Fix: for session definitions, ignore `agentMode` when the parent is in `ask`, or cap it to the parent's mode. Validate `agentMode` against an allowlist at `define`, and show the mode in the start approval.
- Confidence: high for propagation (probed). High for the policy consequence (code-read, not run in a child).

### F4 — `defaultTimeoutMs` is documented and parsed but never enforced

- Severity: medium (dead config).
- Lens: robustness.
- Current: `README.md:19` and `README.md:40` document `defaultTimeoutMs` (default 30 min, 0 disables). `config.ts:16` and `config.ts:148-162` parse it, `config.ts:270-272` stores it. No other source reads it. `start` accepts `timeoutMs` in the schema (`tool.ts:248`) and params (`tool.ts:402`), but the only reader is `wait` (`tool.ts:626`).
- Gap: children have no run deadline.
- Failure/impact: a child that hangs (waiting on a prompt, stuck tool) holds a `maxConcurrent` slot (`tool.ts:494-499`) until a user cancels it. A user who sets `defaultTimeoutMs` gets no effect.
- Reproduction: `grep -rn defaultTimeoutMs extensions/pi-subagents/src | grep -v test` returns only `config.ts`. Read-only check; no runtime probe.
- Fix: pass a deadline in the runner config. Have the runner SIGTERM and then SIGKILL the child at the deadline and write `failed` with a reason. Or delete the key and the README line.
- Confidence: high.

### F5 — `maxConcurrent` check races with parallel `start` calls

- Severity: medium (cap exceeded).
- Lens: robustness.
- Current: count at `tool.ts:494-499`. State is first written in `startSubagent` at `tool.ts:549`, after `await resolveSubagentModel` (`tool.ts:521`) and `await allocateSubagentWorkspace` (`tool.ts:528`). Pi runs tool calls in parallel by default (`node_modules/@earendil-works/pi-agent-core/dist/agent.js:147`, `toolExecution ?? "parallel"`). Same pattern in `resume` at `tool.ts:670-675`.
- Gap: check and reserve are not atomic.
- Failure/impact: two `start` calls in one turn both pass with one slot free, so the cap is exceeded.
- Reproduction: ran `Promise.all([start, start])` with `maxConcurrent: 1`. Output: `started` twice, two states `running` with pids. Control with sequential calls: `started`, then `ERROR maxConcurrent 1 reached`.
- Fix: write the `starting` record under the store lock in the same section that counts, or serialize the start path with a lock file.
- Confidence: high (probed).

### F6 — isolated workspace leaks when child spec construction throws

- Severity: medium (disk leak).
- Lens: robustness.
- Current: `tool.ts:528-531` creates `.pi-workspaces/<id>`. `tool.ts:538` calls `childSpec`, which throws for an unknown harness (`tool.ts:94-97`) or a missing policy package (`tool.ts:57-58`). The `try` at `tool.ts:548-578` starts after `childSpec`, and the outer catch at `tool.ts:770-774` does not clean up.
- Gap: the workspace is not released on this path. `define` accepts any `harness` string (`tool.ts:445-447`), so the model can trigger it.
- Failure/impact: one directory per failed attempt under the project root.
- Reproduction: ran `define {name:"nh", harness:"nope"}`, then `start {agent:"nh", isolated:true}`. Output: `start: unknown harness "nope"`, and `.pi-workspaces/subagent-…` remained.
- Fix: call `childSpec` before `allocateSubagentWorkspace`, or put the allocation inside the `try` that cleans up.
- Confidence: high (probed).

### F7 — isolated workspaces are only cleaned if tracked in memory

- Severity: medium (disk leak across restarts).
- Lens: robustness.
- Current: `workspace.ts:49` keeps `workspaces` as an in-memory `Map`. `workspace.ts:57-59` tracks only on start (`tool.ts:579`). `index.ts:94` cleans only tracked ids.
- Gap: after `/reload` or a restart, the map is empty. Children survive the restart (`architecture.md:14`), but their workspaces are never cleaned. Resumed children are not tracked either.
- Failure/impact: `.pi-workspaces/<id>` accumulates for each isolated child that finishes after a restart.
- Reproduction: event sequence. Start with `isolated: true` (tracked), restart pi, child finishes, `cleanupTerminal(all)` finds no entry. Not run.
- Fix: derive the workspace path from the id on terminal states (the path is `workspacePath(root, id)`), or persist it in the state record.
- Confidence: high (code-read), UNVERIFIED by run.

### F8 — resumed isolated child runs in the main workspace

- Severity: medium (write scope).
- Lens: backend.
- Current: `tool.ts:737` passes `cwd: ctx.cwd` to `startSubagent` on resume. `SubagentState` (`state.ts:14-30`) has no workspace field, so the original path is lost.
- Gap: resume ignores `isolated`. This is the V18 open question, still open.
- Failure/impact: a child started with `isolated: true` writes into the parent's tree after resume.
- Reproduction: event sequence. `start` with `isolated: true` (`tool.ts:528-531`), child fails, `resume` spawns with `cwd: ctx.cwd`. Not run.
- Fix: record `workspace` in the state at start, and reuse it on resume. Refuse resume if it is missing.
- Confidence: high (code-read).

### F9 — write lock released after 10 minutes while the tool still runs

- Severity: medium (mutual exclusion lost).
- Lens: robustness.
- Current: `child.ts:9` `HOLD_TIMEOUT_MS = 10 min`. `child.ts:63-67` schedules `release(event.toolCallId)`. The release happens even if the tool call is still running.
- Gap: a long `bash` or `write` past 10 minutes is no longer excluded, and another child can acquire the lock.
- Failure/impact: two writers can run concurrently. This is the only protection for long writes.
- Reproduction: `createChildLockExtension({ holdTimeoutMs })` (`child.ts:11-20`) exposes the timer. Event sequence: child A `tool_call` at t0, no `tool_result` for `holdTimeoutMs`, timer releases, child B acquires. Not run.
- Fix: renew the lock while the tool is alive (heartbeat in the owner file), or fail the tool call on expiry instead of releasing.
- Confidence: high (code-read), UNVERIFIED by run.

### F10 — stale-lock removal is not conditional on the owner it read

- Severity: medium (two holders possible; high if reproduced).
- Lens: robustness.
- Current: `write-lock.ts:134-141` reads `current`, then `removeStaleLock` (`write-lock.ts:58-64`, `rmSync` of the whole lock dir) runs without re-checking the owner.
- Gap: between the read and the removal, another waiter can remove the stale lock and take it.
- Failure/impact: event sequence. A and B read dead owner X. A removes X's dir and acquires. B then removes A's live dir (`write-lock.ts:136-137`) and acquires. Both hold the lock.
- Reproduction: UNVERIFIED. The interleaving is narrow and was not forced in a run.
- Fix: rename the lock dir to a unique name, then confirm the renamed owner is still X. Restore it if not. Or re-read the owner immediately before removal under a second lock.
- Confidence: medium.

### F11 — `list` renders terminal agents as successful and counts them as active

- Severity: medium (wrong UI state).
- Lens: UI.
- Current: `tool.ts:332-338` shows `●` only for `running`. Every other status, including `failed` and `cancelled`, gets `✓`. Header `tool.ts:330` says `(N active)`. `tool.ts:469-471` returns every state from `listSubagents` (`runner.ts:304-309`, no status filter).
- Gap: icon and count do not match status. The row list is unbounded.
- Failure/impact: a failed child shows a green check. The count includes completed and failed children.
- Reproduction: code-read. Input `[failed, running]` gives header `Subagents (2 active)` and a green `✓ @a [failed]` row.
- Fix: map `failed` to `✗`, `cancelled` to `⊘`, `starting` to `●`. Count only `running` and `starting`. Cap rows and show an expand hint, as the log view does.
- Confidence: high (code-read).

### F12 — result view shows raw RPC JSON lines with no width limit

- Severity: medium (UI churn, unbounded height).
- Lens: UI.
- Current: `tool.ts:368-379` shows the last 6 log lines. Those lines are the child's stdout (`runner-shim.mjs:117-119` pipes it to the log), which is RPC JSONL (`node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js:29`, `writeRawStdout(serializeJsonLine(...))`). `tool.ts:378` passes each line unchanged.
- Gap: no truncation per line, no row cap.
- Failure/impact: a 6-line tail can take many screen rows. The text is JSON, not assistant output.
- Reproduction: 6 synthetic `message_update` lines of about 700 characters, rendered with `@earendil-works/pi-tui` `Text` (`dist/components/text.js` wraps with `wrapTextWithAnsi`). Width 80: 73 rows. Width 40: 139 rows.
- Fix: extract assistant text deltas from the events, or truncate each line with `truncateToWidth` and cap rows.
- Confidence: high for height (probed). Event shape from `rpc-mode.js` (read).

### F13 — `/subagent pause` reports success for finished agents

- Severity: medium (wrong feedback).
- Lens: UI.
- Current: `index.ts:253-256` notifies `Paused subagent ${id}` after `abortSubagent`. `runner.ts:225` returns silently for any status other than `running` or `starting`.
- Gap: the notification does not check the outcome. "Pause" is cancel, not pause.
- Failure/impact: a completed agent shows "Paused", and its state is unchanged.
- Reproduction: code-read. `/subagent pause <completed-id>` runs `abortSubagent`, returns, and notifies.
- Fix: return a result from `abortSubagent`, notify only when it acted, and rename the command or say "cancelled".
- Confidence: high.

### F14 — config diagnostics are computed and never shown

- Severity: medium (silent wrong config).
- Lens: backend.
- Current: `config.ts:225-235` and `config.ts:293-295` report diagnostics only when `onDiagnostic` is passed. Invalid JSON falls back silently (`config.ts:252-255`). Callers `tool.ts:449`, `tool.ts:483`, `tool.ts:664`, and `child.ts:57` pass no callback.
- Gap: a typo in `subagents.json` leaves defaults in place with no message.
- Failure/impact: `maxConcurrent: 20` is clamped to the default, and an invalid harness is dropped. The model then sees `unknown harness`, with no pointer to the config.
- Reproduction: write `{"maxConcurrent": 20}` and call `loadSubagentsConfig` with no callback. Diagnostics are returned in the object but no caller reads them. The call sites were read.
- Fix: pass a notifier from `index.ts` (once per session), or add `diagnostics` to the `start` result.
- Confidence: high.

### F15 — terminal records, logs, and session files are never removed

- Severity: medium (unbounded growth; model-facing output grows with it).
- Lens: performance.
- Current: no code removes state, log, or session files for terminal agents. Only `runner.json` (`runner.ts:166-170`) and the socket (`runner-shim.mjs:249-255`) are removed. `list` returns all records (`tool.ts:469-471`), and every `start` and `resume` lists them all (`tool.ts:494-497`, `tool.ts:670-672`). The ticker lists them every second while agents are active (`index.ts:93`).
- Gap: no retention or cap.
- Failure/impact: the `list` tool result grows with history. Each `start` reads every state file. Disk use grows with session count. Size per record was not measured.
- Reproduction: code-read. Growth is linear in starts, with no measured number.
- Fix: return active agents plus the last N terminal records. Prune terminal records, logs, and session files older than a set age, or on `delete`.
- Confidence: high (mechanism). Magnitude UNVERIFIED.

### F16 — state event and socket probes every second

- Severity: low (churn).
- Lens: performance.
- Current: `index.ts:117` emits `subagents:state` on every tick, changed or not. The ticker is set at `index.ts:122-124`. Each tick reconciles every running agent with a socket connect (`runner.ts:288-291`). Consumers: `pi-todos/src/index.ts:254` and `pi-usage/src/index.ts:147`.
- Gap: no change detection before emit.
- Failure/impact: one emit and up to `maxConcurrent` connects per second. Consumer re-render cost was not checked.
- Reproduction: code-read.
- Fix: emit only when the item list changes.
- Confidence: medium. Consumer re-render is UNVERIFIED.

### F17 — runner socket buffer has no line limit

- Severity: low.
- Lens: robustness.
- Current: `runner-shim.mjs:170-171` appends every chunk to `buffer` with no maximum line length.
- Gap: a client that sends data with no newline grows memory without limit.
- Failure/impact: runner memory growth. Exposure is limited to the same user, since the socket is created under the agent directory.
- Reproduction: code-read.
- Fix: close the connection when `buffer` exceeds a fixed size.
- Confidence: high (code), low impact.

### F18 — abort marks `cancelled` even when the pid is still alive

- Severity: low.
- Lens: robustness.
- Current: `runner.ts:240-251` ignores the return value of `waitForProcessExit`, then `updateIf` sets `cancelled`. `reconcileSubagent` skips terminal states (`runner.ts:279`).
- Gap: a live child can be recorded as `cancelled` and then never reconciled.
- Failure/impact: rare, because SIGKILL follows SIGTERM after 250 ms. It needs a process that survives SIGKILL.
- Reproduction: UNVERIFIED.
- Fix: check the wait result, and keep `failed` with a reason if the pid is still alive.
- Confidence: medium.

### F19 — dead exports and duplicate helpers

- Severity: low (simplicity).
- Lens: simplicity.
- Current:
  - `state.ts:36-40` `requireTrustedProject`: used only by `state.test.ts`.
  - `workspace.ts:34-39` `integrateSubagentWorkspace`: used only by `workspace.test.ts`.
  - `alerts.ts:18-20` `SubagentAlertTracker.seed`: no production caller.
  - `upstream.ts` `mapUpstreamRuns`: re-exported from `index.ts:322`, no in-repo caller outside tests.
  - `runner.ts:67-80` and `write-lock.ts:76-92` define the same `sleep` helper.
- Gap: unused public exports and a duplicated helper.
- Failure/impact: maintenance only.
- Reproduction: grep for each name. Read-only.
- Fix: delete the three unused functions. Share `sleep`, or inline it in one place.
- Confidence: high.

### F20 — child ignores `enterMode` result

- Severity: low.
- Lens: backend.
- Current: `child.ts:35-38` discards the result of `enterMode`. `enterMode` returns `diagnostic: "unknown mode: …"` or a `veto` (`packages/core/src/modes.ts:177-195`).
- Gap: an unknown or vetoed mode leaves the child in default `ask` with no notice.
- Failure/impact: the child is more restricted than the definition says, and nothing reports it.
- Reproduction: code-read. Probe showed `enterMode({}, "edit")` succeeds, so the silent path is only for unknown names.
- Fix: write the diagnostic to the runner log, or fail the child at start.
- Confidence: high.

## Failure modes

- Child spawn fails before the socket listens: runner exits, child survives (F1). Host cleanup does not reach it.
- Child exits non-zero: state `failed`, `resume` allowed (`tool.ts:659`). Correct.
- Runner or child killed by signal: `reconcileSubagent` marks `failed` once both pids are dead (`runner.ts:286`). A live child with an unreachable socket is also marked failed (F2).
- Parent exits or `/reload`: children keep running by design. The ticker stops (`index.ts:314-318`). Reattach is through `list` and `status`. Isolated workspaces are lost from the tracker (F7).
- Cancel: `abortSubagent` kills groups, waits 1 s, then records `cancelled` (`runner.ts:217-251`). Cancel of a terminal agent returns its state without error (`tool.ts:646-651`).
- Duplicate or out-of-order socket messages: each `send` is written to child stdin, with no dedup. A second `abort` is harmless. `send` after exit returns `child is not accepting input` (`runner-shim.mjs:189`).
- Timeouts: none on children (F4). `wait` is capped at 600 s (`tool.ts:626`).
- Write lock: contention times out at `writeLockTimeoutMs` (default 30 s). Holder crash is recovered by the owner pid and start time check (`write-lock.ts:54-56`, `:134-138`). Hold-timeout and stale-race gaps are F9 and F10.
- Session file: two children with the same session (F2 path) would interleave JSONL writes.

## Seams

- `createSubagentTool({ onSubagentsChange, getSessionAgents, defineSessionAgent, deleteSessionAgent })` (`tool.ts:36-41`). Single seam for session definitions and state changes.
- `SubagentStore` wraps `LockedProcessStore` with a sanitize hook (`state.ts:74-85`). Lock name is shared with the runner shim (`runner-shim.mjs:58`).
- `runner-shim.mjs` reimplements state locking and start-time reading in plain JavaScript (`runner-shim.mjs:25-37`, `:40-82`). It runs under `node` and cannot import the TypeScript runtime. The duplication is required by that.
- Child environment contract: `PI_SUBAGENT_DEPTH`, `PI_SUBAGENT_ID`, `PI_SUBAGENT_MODE` set at `tool.ts:564-569` and `tool.ts:743-748`, read at `child.ts:35`, `child.ts:42`, `child.ts:76`, `child.ts:100`.
- Write-tool list is duplicated: `child.ts:8` (`write`, `edit`, `bash`) and `packages/policy/src/targets.ts` tags. Keep them in sync.

## Rejected defaults

- Children survive parent exit and `/reload`. Durable detached agents are the design (`artifacts/architecture.md:14`).
- Children inherit the full parent environment, including provider keys (`runner-shim.mjs:117-119`). Pi children need it.
- `--append-system-prompt` puts the system prompt in argv, visible to same-user `ps`. Same trust boundary as the user.
- Latest-wins duplicate names and case-sensitive names: tested and documented (V18).
- `define` works in untrusted projects, `start` and `resume` require trust (`tool.ts:475`, `tool.ts:654`). Documented in `README.md`.
- Session definitions shadow file agents. Documented.
- `maxConcurrent` counts `starting` and `running` only. Intended.
- Startup deadline of 5 s. Host default, not a finding.

## Open Questions

- Isolated workspace: `allocateWorkspace` makes an empty directory under `.pi-workspaces/<id>` (`packages/core/src/workspace.ts:25-44`). It does not copy or worktree the repo. Is an empty directory the intended behavior for "dedicated isolated workspace"? This decides whether F6, F7, and F8 matter in practice.
- Generic harnesses run without the headless policy or the write lock (`README.md:109`). The model can pick any configured harness name through `define` (`tool.ts:445-447`). Should `start` on a non-pi harness need explicit approval?
- Write lock scope: `write.lock` lives under the agent directory (`write-lock.ts:27-29`), so all children across all repos serialize their writes. Is that intended? Parent-session writes are not locked. Should they be?
- `defaultTimeoutMs`: enforce it (F4) or remove it?
- Should session definitions be able to set a mode at all (F3)?

## Verdict

fail

Three high findings are backed by runs or direct reproduction: F1 (orphaned child after a runner failure), F2 (live child marked failed, abort blocked, resume allowed), and F3 (model-defined mode reaches the child env while the parent is in `ask`). Probes were run from `/tmp/probe-r2` and removed.
