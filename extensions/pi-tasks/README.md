# `@hollowheap/pi-tasks`

Durable background shell tasks for the Pi coding agent.

`pi-tasks` registers a single direct `task` tool (`start`, `list`, `status`, `wait`, `cancel`) while leaving Pi's built-in foreground `bash` tool untouched.

## Features

- **Direct `task` tool**: Always callable without codemode activation (`exposure` omitted).
  - `start`: Spawns a shell command in the background via a detached Node runner shim (`detached: true`, `stdio: "ignore"`, `unref()`) in its own process group. Returns the assigned task `id`, `pid`, and log path immediately.
  - `list`: Reconciles liveness and lists all persisted tasks in `<agentDir>/tasks/`.
  - `status`: Returns reconciled metadata and current log output bounded by `@hollowheap/core` `truncateText`.
  - `wait`: Blocks until the task exits, `timeoutMs` elapses (default `30000` ms, max `600000` ms), or the call is aborted — including across Pi restarts by watching/polling `<id>.json`. Background task completion never triggers an unsolicited model turn.
  - `cancel`: Verifies process liveness, sends `SIGTERM` followed by a `SIGKILL` grace period to the process group, and records `status: "cancelled"`.
- **Built-in `bash` stays untouched**: Foreground commands continue to use Pi's native `bash` tool. Commands intended to run in the background are started explicitly with `task({ action: "start", command })`.
- **`pi-guard` and `pi-hooks` enforcement**:
  - `pi-guard` gates `task` calls with `action: "start"` under `tag: "shell"` (prompting via `ctx.ui.confirm` on `"ask"` and blocking on `"deny"`), while allowing `list`, `status`, `wait`, and `cancel` without prompting.
  - `pi-tasks` also evaluates `@hollowheap/core` shell permissions in `effectiveCwd` as defense-in-depth.
- **Durable `<agentDir>/tasks/` storage & PID + `startTime` reconciliation**:
  - Task metadata is written atomically to `<agentDir>/tasks/<id>.json` (`0600`) and combined stdout/stderr streams to `<agentDir>/tasks/<id>.log` (`0600`) inside `<agentDir>/tasks/` (`0700`).
  - Each running task records both `pid` and OS process `startTime` (`/proc/<pid>/stat` field 22 on Linux) to prevent PID-reuse false positives across restarts. Dead or mismatched processes reconcile to `status: "failed"`, `exitCode: null`.
  - `session_shutdown` leaves durable shell tasks running; cleanup of `<agentDir>/tasks/` is manual in v1.
- **Project trust gate**: `task({ action: "start", ... })` requires `ctx.isProjectTrusted() === true` before spawning.
- **Statusline integration**: Publishes `ctx.ui.setStatus("tasks", "<n> running")` when tasks are running and clears it (`undefined`) when `0`.
- **ACP inactivity**: Inactive under ACP (`-ne` omits user extensions, and `PI_ACP` leaves `pi-tasks` inert so `acp_bash` remains the sole terminal path).
- **Generic v1 task layer**: `TaskRecord` (`id`, `kind`, `status`, `command`, `cwd`, `pid`, `startTime`, `startedAt`, `finishedAt`, `exitCode`, `output`, `wait`, `cancel`) is generic (`kind: "shell" | "subagent"`, with `"shell"` implemented in v1).

## Tool Schema

```ts
task({
  action: "start" | "list" | "status" | "wait" | "cancel",
  command?: string,   // required for start
  id?: string,        // required for status, wait, cancel
  timeoutMs?: number  // optional for wait (default 30000, max 600000)
})
```

## Install

```bash
pi install npm:@hollowheap/pi-tasks
```
