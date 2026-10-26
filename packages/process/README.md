# @hollowheap/process

Node-only detached process primitives shared by durable task and subagent packages. No Pi host imports.

## Exports

- `spawnDetachedProcess` — spawn a detached process with stdout/stderr appended to a `0600` log.
- `readProcStartTime` / `isProcessAlive` — PID plus Linux start-time reconciliation.
- `cancelProcessGroup` — SIGTERM the process group, then SIGKILL after a grace period.
- `waitForProcessExit` — bounded liveness polling with abort support.
- `readLog` — read a process log.

State files and Unix sockets are added by the process-layer state/socket modules.
