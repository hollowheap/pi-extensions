# Review — packages/runtime (V21)

## Scope

- Commit: a035b03.
- Paths: `packages/runtime/src/{exec,process,lifecycle,sandbox,socket,state,store,index}.ts`. Source is about 1,026 LOC. Tests are excluded.
- Consumers checked with `rg`: `extensions/pi-tasks/src/{runner,registry,index}.ts`, `extensions/pi-subagents/src/{state,runner,socket,write-lock,child}.ts`, `extensions/pi-hooks/src/hooks.ts`, `packages/core/src/alerts.ts`, `packages/pi-acp/src/extension/tools.ts`, `extensions/pi-language-tools/src/tool.ts`, `extensions/pi-dashboard/src/exec.ts`.
- Prior reviews skimmed: `artifacts/review/pi-tasks.md` (V12 resolutions at lines 40-47), `artifacts/review/pi-subagents.md` (V11 findings at lines 77-86; resolved items not repeated here).
- Lenses: robustness, backend, performance, UI, simplicity.
- Probes ran from `/tmp/v21` and were deleted after the run. `npm test` and typecheck were not re-run for this review.

## Findings

### F1 — Stale-lock break lets a second writer enter the critical section

- ID: F1
- Severity: medium (mutual exclusion violated, possible lost update; needs a holder stall longer than 2 s)
- Lens: Robustness (lock correctness)
- Current:
  - `packages/runtime/src/store.ts:29-33` breaks any lock whose mtime is older than `STALE_LOCK_MS` (2000 ms) with `unlinkSync(path)`. It does not check that the lock still belongs to the stale owner.
  - `packages/runtime/src/store.ts:19-23` returns a release closure that unconditionally calls `unlinkSync(path)`.
- Gap: The release path deletes whatever lock file exists, including a lock acquired by a later process after a stale break. The lock file has no owner token.
- Failure/impact: Holder A stalls for more than 2 s inside `updateIf`. B breaks the lock and enters. A resumes and releases, deleting B's lock. C enters while B is still inside its predicate. Two read-modify-write cycles then overlap, and one update can be lost.
- Reproduction: three processes against `LockedProcessStore` (`/tmp/v21/p9_holder.mjs`, `/tmp/v21/p9_run.sh`). A sleeps 2500 ms inside the predicate, B starts at 2.2 s and sleeps 1000 ms, C starts at 2.7 s. Log output:
  ```
  B predicate enter t=1      (B holds the lock after stale break)
  A predicate exit t=2501; A done t=2503   (A's release deletes B's lock)
  C predicate enter t=1      (C enters while B is still inside)
  C done t=2
  B predicate exit t=1001
  ```
- Fix (minimal): Write `pid:startTime:random` into the lock file. Release unlinks only when the file content still matches the token. Before breaking a stale lock, re-read and compare the token, then unlink.
- Confidence: high for the overlap (observed). Likelihood is low in practice because the critical section is synchronous and short.

### F2 — Timeout and abort kill only the direct child; grandchildren survive

- ID: F2
- Severity: medium
- Lens: Robustness (command execution, cancellation)
- Current: `packages/runtime/src/exec.ts:64-70` passes `timeout` and `signal` to `execFile`. Node sends the signal to the direct child only. No process group is created (`detached` is not set).
- Gap: Shell children and their descendants keep running after timeout or abort. The callback returns on time, so the rejection is not delayed; the leaked process is the problem.
- Failure/impact: A timed-out or aborted hook, alert, or dashboard command leaves a background process running. Abort does not stop the work it started.
- Reproduction: `/tmp/v21/p1b.mjs`. `runBinary("sh", ["-c", "sleep 20 & wait"], "/tmp", undefined, { timeoutMs: 300 })` rejects after about 509 ms. Then `pgrep -f "^sleep 20$"` finds the grandchild still running.
- Fix (minimal): Spawn with `detached: true` and kill `-pid` on timeout and abort, reusing the signalProcessGroup pattern from `process.ts:159-170`. Or document that only the direct child is killed.
- Confidence: high (observed).

### F3 — Command rejection text includes full argv

- ID: F3
- Severity: medium (exposure when argv carries secrets and the message reaches logs or UI; reach UNVERIFIED for pi-hooks)
- Lens: Backend (secrets in errors)
- Current: `packages/runtime/src/exec.ts:99` builds the rejection as `` `${command} failed: ${String(stderr || error.message).trim()}` ``. When stderr is empty (timeout, abort, or silent exit), `error.message` from `execFile` contains `Command failed: <cmd> <args...>`.
- Gap: The full argument list is copied into the error. Args are not redacted.
- Failure/impact: Tokens or other secrets passed as args appear in any error that callers log or show.
- Reproduction: `/tmp/v21/p3_secret.mjs`. `runBinary("sh", ["-c", "sleep 5", "SECRET_TOKEN_XYZ"], "/tmp", undefined, { timeoutMs: 200 })` rejects with `"sh failed: Command failed: sh -c sleep 5 SECRET_TOKEN_XYZ"`.
- Fix (minimal): On the non-numeric-code path, use `stderr` or a fixed `timed out` / `aborted` / `signal <name>` string. Do not interpolate `error.message`.
- Confidence: high for the leak in the message. Reach into `extensions/pi-hooks/src/hooks.ts:115` error output UNVERIFIED.

### F4 — cancelProcessGroup skips group kill once the leader has exited

- ID: F4
- Severity: medium
- Lens: Robustness (process group kill, detached lifecycle)
- Current: `packages/runtime/src/process.ts:178` `if (!isProcessAlive(pid, startTime)) return false;` runs before any signal is sent. `extensions/pi-tasks/src/runner.ts:165` has the same gate before it calls `cancelProcessGroup`.
- Gap: The group check only looks at the leader. A detached shell that exits early but leaves background children in its group is never signaled.
- Failure/impact: `cancelTask` reports no work to cancel and the grandchild keeps running. Its output keeps going to the task log.
- Reproduction: `/tmp/v21/p5_orphan_group.mjs`. `spawnDetachedProcess({command:"sh", args:["-c","sleep 60 & echo $!; exit 0"]})` leaves the leader dead and the grandchild alive. `cancelProcessGroup(pid, startTime, 250)` returns `false` and the grandchild is still alive.
- Fix (minimal): When the leader is gone, still send `process.kill(-pid, "SIGTERM")` and treat ESRCH as nothing to do. A pgid cannot be reused while group members exist, so the group signal is safe. Return `true` only if a signal was delivered.
- Confidence: high (observed). Extends the resolved pi-tasks item at `artifacts/review/pi-tasks.md:42`, which covered only the still-alive leader case.

### F5 — Zombie leader counts as alive

- ID: F5
- Severity: medium
- Lens: Robustness (zombie reaping, PID checks)
- Current: `packages/runtime/src/process.ts:72` `process.kill(pid, 0)` succeeds for a zombie. `process.ts:77-80` checks start time but never reads the process state field.
- Gap: `isProcessAlive` has no check for state `Z`.
- Failure/impact: A dead runner or task whose parent has exited and that is not reaped stays "alive". `cancelProcessGroup` then waits about 1.25 s and returns `true` without signaling anything (`process.ts:183-185`). `pi-tasks` keeps the task `running` (`extensions/pi-tasks/src/runner.ts:165-168`). Reach depends on a non-reaping PID 1, typical of containers without an init; UNVERIFIED in the user's environment.
- Reproduction: `/tmp/v21/p4_zombie.mjs` with `p4_zombie.py`. The Python child exits and the parent never waits, so the child becomes a zombie (`/proc/<pid>/stat` state `Z`). `isProcessAlive(zpid)` returns `true`, and `cancelProcessGroup(zpid, undefined, 250)` returns `true` after 1251 ms.
- Fix (minimal): In `isProcessAlive`, read `/proc/<pid>/stat`; if the state field is `Z`, return `false`. Fall back to the current check when `/proc` is missing.
- Confidence: high for the observed result. Environment reach UNVERIFIED.

### F6 — Atomic state write leaves temp files behind and never fsyncs

- ID: F6
- Severity: medium
- Lens: Robustness (atomic write)
- Current: `packages/runtime/src/state.ts:82-90`. The temp file is written with `writeFileSync` (line 84) and then `renameSync` (line 90). There is no `try`/`finally` cleanup and no `fsync` before the rename.
- Gap: Any throw between the write and the rename leaves the `.<id>.<pid>.<hex>.tmp` file. `list()` skips dot-files (`state.ts:113`), so nothing removes them.
- Failure/impact: Each failed write (ENOSPC, EISDIR, EACCES on rename) leaves a file that is never cleaned. After a power loss, the renamed file can be empty or stale because data was not flushed (durability UNVERIFIED; needs a power-loss test).
- Reproduction: `/tmp/v21/p6_tmp_leak.mjs`. Making the target `blocked.json` a directory causes `write` to throw `EISDIR`, and the directory afterwards contains `.blocked.<pid>.<hex>.tmp`.
- Fix (minimal): Wrap write and rename in `try`/`catch` that unlinks the temp file and rethrows. Add `openSync`, `writeSync`, `fsyncSync`, `closeSync` before the rename.
- Confidence: high for the leak (observed). Durability claim UNVERIFIED.

### F7 — readLog returns an empty string for logs over the V8 string limit

- ID: F7
- Severity: medium
- Lens: Robustness, Performance
- Current: `packages/runtime/src/process.ts:114-121` calls `readFileSync(logPath, "utf8")` inside a bare `catch` that returns `""`. `packages/runtime/src/store.ts:116-120` wraps it again, with another bare catch.
- Gap: The whole log is read into memory with no cap. Any error, including the string-length `RangeError`, is turned into an empty log with no marker.
- Failure/impact: Once a task log grows past about 512 MB, `pi-tasks` (`extensions/pi-tasks/src/registry.ts:82`) and `pi-subagents` (`extensions/pi-subagents/src/runner.ts:313`) show an empty log without any error.
- Reproduction: `/tmp/v21/p2_readlog.mjs`. A 600 MB file gives `readLog(...).length === 0`.
- Fix (minimal): Read only the last N bytes (for example 1 MiB) with `openSync` and `readSync` at an offset, and prepend a truncation notice. Remove the catch-all so real I/O errors surface.
- Confidence: high (observed).

### F8 — Socket prepare deletes any non-socket file at the path

- ID: F8
- Severity: medium (data loss when a path is misconfigured or reused)
- Lens: Robustness (socket server)
- Current: `packages/runtime/src/socket.ts:76-85` `prepareSocketPath`. When `canConnect` fails (any non-socket file is refused), it calls `unlinkSync(path)` (line 83).
- Gap: The code never checks the file type before unlinking.
- Failure/impact: Passing a path to `startJsonlServer` that holds user data deletes that file.
- Reproduction: `/tmp/v21/p7_socket_unlink.mjs`. A `notes.txt` at the socket path is deleted by `startJsonlServer`.
- Fix (minimal): `lstatSync(path)` and unlink only when `isSocket()`. Otherwise throw `path exists and is not a socket`.
- Confidence: high (observed).

### F9 — Socket file mode is set after listen

- ID: F9
- Severity: low
- Lens: Robustness (socket permissions)
- Current: `packages/runtime/src/socket.ts:154` `server.listen(path)`, then `socket.ts:156` `chmodSync(path, 0o600)`.
- Gap: The socket exists with the umask-derived mode until the chmod runs.
- Failure/impact: On a system with a permissive umask, another local user could connect during the window. The parent directory is 0700 only when this code creates it (`socket.ts:77`). Exploitability UNVERIFIED.
- Reproduction: `/tmp/v21/p8_socket_perm_window.mjs` shows the final mode 600 and dir 700. The window itself was not measured.
- Fix (minimal): Call `process.umask(0o177)` around `listen`, or verify the parent directory mode is 0700 before listening.
- Confidence: medium.

### F10 — Socket size cap counts UTF-16 units, and the check runs before line splitting

- ID: F10
- Severity: low
- Lens: Robustness (partial and oversized lines)
- Current: `packages/runtime/src/socket.ts:105` and `socket.ts:213` compare `buffer.length` (UTF-16 code units) with `maxLineBytes`. The check runs on the accumulated buffer before the newline loop (`socket.ts:103-110`).
- Gap: The name says bytes but the value counts code units. A single chunk containing many complete small lines larger than the limit is rejected as "request too large".
- Failure/impact: Pipelined requests in one burst can be dropped with an error. Byte-based callers get a different limit than documented.
- Reproduction: Code read; not probed.
- Fix (minimal): Split complete lines before checking, and check only the leftover partial line length. Use `Buffer.byteLength` if byte semantics are intended.
- Confidence: medium (code read only).

### F11 — Client reports server-generated errors as an id mismatch

- ID: F11
- Severity: low
- Lens: Backend (consistent error shape)
- Current: The server sends `{id: null, ok: false, error}` for invalid JSON, invalid request, and oversized input (`socket.ts:105-108`, `socket.ts:117-130`). The client treats any `id !== request.id` as a mismatch (`socket.ts:227-229`).
- Gap: The server's error text is discarded.
- Failure/impact: A caller that sends an oversized request sees `socket response id mismatch` instead of `request too large`.
- Reproduction: `/tmp/v21/p11_mismatch.mjs` with a 5000-byte payload and `maxLineBytes: 1000`. Client error: `socket response id mismatch`.
- Fix (minimal): When `parsed.id === null && parsed.ok === false`, reject with `parsed.error`.
- Confidence: high (observed).

### F12 — Sandbox module and `sandbox` option have no consumers

- ID: F12
- Severity: medium (dead config and dead code)
- Lens: Simplicity (deletion test)
- Current: `packages/runtime/src/sandbox.ts` (132 LOC) and `packages/runtime/src/exec.ts:9`, `:16`, `:47-62` (`sandbox?: boolean | SandboxOptions` and the wrap branch). `packages/runtime/src/index.ts:7` re-exports the module. `sandbox.test.ts` (252 LOC) tests it.
- Gap: `rg "sandbox"` across `extensions/` and `packages/` (excluding runtime) finds no caller that passes `sandbox`.
- Failure/impact: Users believe bash or hook execution is sandboxed when no code path turns it on. The shipped `buildSandboxArgs` also leaves `~/.aws`, `~/.config`, and the full inherited environment readable (`sandbox.ts:76-84`, `DEFAULT_MASK_PATHS` lines 20-23), so enabling it later would not be a complete boundary.
- Fail-safe evidence: `/tmp/v21/p10_sandbox.mjs`. With `bwrapBinary: "/nonexistent/bwrap"`, `runCapture` rejects with `Bubblewrap sandbox is required but '/nonexistent/bwrap' was not found on PATH`. The missing-binary path therefore fails closed. With `bwrap` present, `sandbox: true` runs and returns the command's exit code. If bwrap exists but user namespaces are disabled, bwrap's own failure exit code would be indistinguishable from the command's exit code (UNVERIFIED; this host has bwrap and namespaces work).
- Fix (minimal): Delete `sandbox.ts`, its test, the `sandbox` option, and the re-export, or keep them only with a named consumer. Do not expand the mask list without a threat model.
- Confidence: high that there are no consumers. Confidence medium on the mask-coverage claim (code read).

### F13 — Two socket connect probes; one leaks a timer and uses dynamic imports

- ID: F13
- Severity: low
- Lens: Simplicity, Robustness
- Current: `packages/runtime/src/socket.ts:57-70` `canConnect` and `packages/runtime/src/process.ts:188-222` `isSocketConnectable`. The second one uses `await import("node:fs")` and `await import("node:net")` at `process.ts:193-194` for modules that can be static imports, and its timer `process.ts:214` is never cleared when the socket connects (`done` at lines 201-212 does not call `clearTimeout`).
- Gap: Same behavior in two places. The duplicate keeps the event loop alive for up to 200 ms after each successful probe.
- Failure/impact: Small. Consumer `extensions/pi-subagents/src/runner.ts:291` uses the copy in `process.ts`.
- Reproduction: Code read.
- Fix (minimal): Keep one probe in `socket.ts`, export it, and clear the timer on connect.
- Confidence: high for the duplication.

### F14 — Unlocked write and update paths sit beside the locked store

- ID: F14
- Severity: low
- Lens: Simplicity, Robustness
- Current: `packages/runtime/src/store.ts:81-83` `LockedProcessStore.write` does not take the lock. `packages/runtime/src/state.ts:116-123` `ProcessStore.update` is a lock-free read-modify-write and has no consumer outside runtime (`rg "\.update\("` in consumers hits only `LockedProcessStore.update` at `extensions/pi-subagents/src/state.ts:118`).
- Gap: Two paths can write a state file without the lock, and one of them is unused.
- Failure/impact: A caller that uses `write` for an existing id can overwrite a concurrent `updateIf` result. Whether `extensions/pi-subagents/src/state.ts:111` does that is UNVERIFIED; the pi-subagents V11 finding on state races (`artifacts/review/pi-subagents.md:81`) may cover it.
- Fix (minimal): Delete `ProcessStore.update`. Document `LockedProcessStore.write` as creation-only, or route it through the lock.
- Confidence: high for dead `ProcessStore.update`; medium for the race.

### F15 — `clampMaxResults` is a consumer policy in the process runtime

- ID: F15
- Severity: low
- Lens: Simplicity
- Current: `packages/runtime/src/exec.ts:28-31` clamps a search result count to 1..500 with a default of 100. Consumers: `packages/pi-acp/src/extension/tools.ts:471`, `:528` and `extensions/pi-language-tools/src/tool.ts:762`.
- Gap: Result-count policy sits beside process execution. It is not a runtime primitive.
- Failure/impact: Low. The package now carries an unrelated export that other changes can break.
- Fix (minimal): Move it into the two consumers or to `packages/core`, where other formatting helpers live.
- Confidence: high.

## Failure modes

- Holder stall above 2 s inside `updateIf` causes lock overlap (F1). Probe shows the overlap.
- `isProcessAlive` returns `true` when `readProcStartTime` returns `undefined` during an exit race (`process.ts:77-80`). The identity check is then skipped. Only a race within one syscall window; not probed.
- `readProcStartTime` falls back to `ps lstart` (epoch ms, `process.ts:37-46`) while Linux `/proc` returns clock ticks (`process.ts:47-62`). If `/proc` is readable at spawn and unreadable later, or the reverse, the stored start time and the current one use different units and the identity check fails. Only occurs if `/proc/<pid>/stat` read fails for one pid and succeeds for another; UNVERIFIED on the user's system.
- `cancelProcessGroup` returns `true` after SIGKILL and a 1 s wait even when the process is still alive (`process.ts:183-185`). Callers re-check (`extensions/pi-tasks/src/runner.ts:167`), so the damage is limited.
- `acquireStateLock` blocks the calling thread up to 1 s in `sleepSync(5)` (`store.ts:9-11`, `store.ts:44`) under contention. Lock hold time is milliseconds, so this is rare.
- Power loss during `ProcessStore.write` can leave a renamed but unflushed file (F6). UNVERIFIED.
- Socket server: oversized line closes the connection after an error reply (`socket.ts:105-109`). Malformed JSON gets an error and the connection stays open (`socket.ts:117-123`). Client disconnect removes the socket from the set (`socket.ts:102`). Close unlinks the socket (`socket.ts:163-166`). Handler promises have no timeout (`socket.ts:137-146`); a hung handler holds its request open until the client times out. UNVERIFIED impact.
- Detached spawn: the log fd is closed in `finally` (`process.ts:111`) and the child keeps its own duplicate. `child.unref()` (`process.ts:102`) and the `error` listener (`process.ts:98`) are correct. Zombie reaping is handled by Node while the spawning process lives (F5 covers the residual case).

## Seams

- `LockedProcessStore<T>` (`store.ts:52-121`): consumers `extensions/pi-tasks/src/registry.ts:27-28`, `extensions/pi-subagents/src/state.ts:75-82`. Public API: `updateIf`, `update`, `write`, `read`, `list`, `log`. The `sanitize` option (`store.ts:49`) is used by pi-subagents (`extensions/pi-subagents/src/state.ts:82`).
- `spawnDetachedTask` (`lifecycle.ts:15-42`): consumers `extensions/pi-tasks/src/runner.ts:88`, `extensions/pi-subagents/src/runner.ts:131` (uses `patch`). The write-then-spawn-then-update sequence has no rollback if `update` throws; the catch at `lifecycle.ts:38-40` silently ignores it.
- `runCapture` / `runBinary` (`exec.ts:37-121`): consumers `packages/core/src/alerts.ts:52`, `extensions/pi-hooks/src/hooks.ts:115`, `extensions/pi-dashboard/src/exec.ts:9`, `packages/pi-acp/src/extension/tools.ts:448-555` (uses `okExitCodes: [1]` at line 516).
- JSONL socket (`socket.ts:89-166` server, `socket.ts:177-249` client): consumers `extensions/pi-subagents/src/socket.ts:24`, `extensions/pi-subagents/src/socket.test.ts`.
- `index.ts:1-7` re-exports every module with `export *`, so unused surface (`sandbox`, `isBwrapAvailable`, `assertBwrapAvailable`, `buildSandboxArgs`) is public.
- UI: N/A. Runtime emits no user-facing text except error strings that flow into consumer UI (F3, F11).

## Rejected defaults

- Child env inherits the full `process.env` when `env` is undefined (`process.ts:91`). Host behavior. Restricting it would change every consumer.
- `DEFAULT_TIMEOUT_MS` 30 s and `DEFAULT_MAX_BUFFER` 1 MiB (`exec.ts:24-25`). Reasonable bounds, and the callers pass explicit values where needed.
- Socket line cap 1 MiB and request timeout 30 s (`socket.ts:36-37`). Bounds exist; the cap's unit issue is F10.
- Lock timeout 1 s, stale threshold 2 s, poll 5 ms (`store.ts:6-7`, `:44`). The stale threshold is covered by F1; the rest are reasonable for ms-long critical sections.
- Process wait poll 50 ms and SIGTERM grace 250 ms (`process.ts:147`, `:173`). Low cost at expected task counts.
- `ProcessStore.list` reads every JSON file each call (`state.ts:110-120`). Expected load is a small number of tasks and subagents; no measured cost.
- `ensureLog` and `chmod` best-effort swallowing (`state.ts:70-73`, `:91-93`). Filesystems without POSIX modes.
- Socket errors reach the client verbatim (`socket.ts:117-131`). The socket is 0600 in a 0700 directory, so exposure is limited to the same user.

## Open Questions

- Should `runCapture`'s `sandbox` option be kept with a named consumer, or deleted (F12)? The answer decides whether the masked-path list needs a threat model.
- Should the detached task API promise that cancel kills the whole process group, including after the leader exits (F4)? That decides whether the group signal goes in `cancelProcessGroup` or the caller.
- Who reaps detached children when the spawning pi process exits in a container without an init (F5)?
- Is the log size bounded by policy? Detached children write to the log with no rotation (`process.ts:92-95`), and F7 only bounds the read side.

## Verdict

pass-with-findings

No high-severity finding was evidenced. Nine medium findings were recorded (F1 to F8, F12), each with a reproduction or a precise code citation. Eight have probe output (F1 to F8). F1 needs an unusual holder stall to matter in practice.
