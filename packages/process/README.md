# @hollowheap/process

Node-only detached process, state, and Unix-socket primitives shared by durable task and subagent packages. No Pi host imports.

## Exports

### Lifecycle

- `spawnDetachedProcess` — spawn a detached process with stdout/stderr appended to a `0600` log.
- `readProcStartTime` / `isProcessAlive` — PID plus Linux start-time reconciliation.
- `cancelProcessGroup` — SIGTERM the process group, then SIGKILL after a grace period.
- `waitForProcessExit` — bounded liveness polling with abort support.
- `readLog` — read a process log.

### State

- `ProcessStore` — a directory-backed JSON state store.
- `ProcessState` — `id`, `status`, `startedAt`, optional PID/start time, finish fields, and consumer fields.

`ProcessStore` keeps its directory `0700`, writes state atomically through a temp file plus rename, writes files `0600`, tolerates corrupt state as missing, and lists valid records in start order.

### Socket

- `startJsonlServer(path, handler)` — a private Unix socket serving one JSON object per line.
- `requestJsonl(path, request, options)` — request/response client with timeout and abort.
- `JsonlRequest` / `JsonlResponse` — `{id, action, payload}` and `{id, ok, payload?, error?}` envelopes.

The server limits line size, ignores malformed lines with an error response, rejects a live duplicate socket, removes a stale socket path, and cleans up on close. Consumers define action names and payloads; the package carries no task or agent semantics.
