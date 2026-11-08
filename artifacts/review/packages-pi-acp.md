# Review — packages/pi-acp (V23)

## Scope

- Commit: a035b03 (branch main). Prior review: none.
- Paths: `packages/pi-acp/src/**` excluding tests (2692 LOC): `adapter.ts`, `main.ts`, `acp.ts`, `pi-rpc.ts`, `sessions.ts`, `socket.ts`, `client-requests.ts`, `extension/index.ts`, `extension/tools.ts`, `extension/client.ts`, `extension/permissions.ts`.
- Reference seams: `packages/runtime/src/{socket,state,exec}.ts`, `packages/core/src/policy.ts`.
- Spec: https://agentclientprotocol.com (prompt-turn, tool-calls, terminals, file-system, initialization pages, fetched this session). No ACP SDK is installed in `node_modules`; the server hand-rolls JSON-RPC.
- Lenses: backend, robustness, performance, UI, simplicity (all five).
- Probes ran from `/tmp/v23` (fake `pi` child, in-process harness via jiti, `driver.mjs` end-to-end). Probes were deleted afterwards. Nothing in the repo changed. Baseline (`npm test`, typecheck, lint) was taken from the brief and not re-run. `dist/` was not rebuilt.
- Real `pi --mode rpc` was used only for the stdin EOF check. End-to-end runs against a real model were not done.

## Findings

### F1

- Severity: high
- Lens: Backend (session/cancel)
- Current: `src/main.ts:100` dispatches only when `isRequest` passes; `src/acp.ts:41-49` requires `id`. A notification (no `id`) falls through `src/main.ts:120-146` and is dropped with no output. `src/adapter.ts:595-601` `cancelSession` is only reachable through that request path.
- Gap: The ACP prompt-turn spec defines `session/cancel` as a notification that Agents MUST support.
- Failure/impact: A spec-compliant client's cancel is a no-op. The prompt stays pending, the turn keeps running, and tool calls keep executing until the turn ends by itself.
- Reproduction: Fake pi child with a prompt that triggers a permission request, then a `session/cancel` notification (no `id`). After 1.5 s, no `stopReason` was returned, and `pi.abort` was never sent. The same sequence with an `id` returned `{"stopReason":"cancelled"}`.
- Fix (minimal): In `main.ts` `onLine`, when `method` is a string and `id` is absent, call `adapter.handle(method, params)` and log errors instead of writing a response.
- Confidence: high (probe and spec text)

### F2

- Severity: high
- Lens: Robustness (crash, lockout)
- Current: `src/sessions.ts:20` `JSON.parse(raw)` has no try/catch. `src/sessions.ts:34` `writeFileSync(path, ...)` writes in place. `src/adapter.ts:901` (`agent_settled`) calls `touch` (`src/adapter.ts:428-433`), which calls `loadStore`. `src/pi-rpc.ts:70-80` and `:103` call `onEvent` with no guard, inside the child `stdout` `data` listener (`src/pi-rpc.ts:43`).
- Gap: A malformed store throws inside an event listener, so the exception is uncaught. The write is not atomic. `packages/runtime/src/state.ts:83-90` already does tmp-file plus `renameSync`.
- Failure/impact: A truncated `sessions.json` crashes the whole ACP server at the next `agent_settled`. Every client's sessions go down with it. On restart, every `session/new` fails at `src/adapter.ts:393` (`loadStore`) until someone repairs the file by hand.
- Reproduction: Fake pi on prompt "corrupt" writes `[{"sessionId":` to the store and then emits `agent_settled`. The adapter printed `SyntaxError: Unexpected end of JSON input` at `sessions.ts:20`, called from `adapter.ts:430` and `adapter.ts:901`, and exited with code 1.
- Fix (minimal): `loadStore` catches parse errors, moves the file aside, and returns `[]`. `saveStore` writes to a temp file and renames it (same pattern as `runtime/src/state.ts`). Wrap the `piEvent` body in try/catch and log.
- Confidence: high

### F3

- Severity: high
- Lens: Robustness (data loss, fail-open)
- Current: `src/extension/tools.ts:307-313` (`acp_write`): `catch { exists = false; }` after a failed `readThroughClient`, then `writeThroughClient` at `:316-318`. `src/extension/tools.ts:359-368` (`acp_edit`): `catch { remote = undefined; }` skips the buffer-vs-disk guard, then `writeThroughClient` or `writeFileSync` at `:371-373`.
- Gap: An unreadable editor buffer is treated as "no conflict" (edit) or "file absent" (write). The guard fails open. `REQUEST_TIMEOUT_MS` is 10 s (`tools.ts:21`).
- Failure/impact: If the editor read times out or errors while the editor holds unsaved changes, `acp_edit` overwrites them and reports "Edited". `acp_write` overwrites a file that the client has and pi cannot see.
- Reproduction: In-process probe with `createAcpTools` and stub deps where `fs-read` throws. `acp_edit` returned `Edited edit.txt` and recorded the calls `permission,fs-read,fs-write`. The guard was skipped. For `acp_write` the same stub returned `Created remote-only.txt` with `permission,fs-read,fs-write`.
- Fix (minimal): Let the `fs-read` error propagate in `acp_edit` (throw). In `acp_write`, continue only when the read fails with a not-found error.
- Confidence: high for the mechanism. A real editor timing out has not been reproduced (UNVERIFIED).

### F4

- Severity: medium
- Lens: Backend (permission requests)
- Current: `src/main.ts:46` arms a timer only if `timeoutMs` is set. `src/adapter.ts:733` calls `requestPermission` with no timeout. `src/client-requests.ts:79-82` passes no timeout. `src/extension/tools.ts:99` `askPermission` calls `callSocket` with no timeout and no `AbortSignal`. The `_signal` parameter is unused at `tools.ts:276, 299, 342, 543`.
- Gap: Unanswered permission requests are never expired. The entries in `main.ts` `pending` and in `session.pendingClient` persist until the session closes. Cancel does not reach `askPermission`.
- Failure/impact: A client that never answers `session/request_permission` leaves the tool call, and the turn, waiting until the session closes. Whether pi's abort ends a turn while a tool waits on this promise is UNVERIFIED (needs real pi with a model).
- Reproduction: Probe scenario cancel-request. The `session/request_permission` reached stdout, the client never replied, and no timer fired. The only exit was the abort path.
- Fix (minimal): Give permission requests a timeout that resolves to `reject_once`. Pass the tool's `AbortSignal` into `askPermission` and reject on abort.
- Confidence: medium (timeout absence is certain, the turn-wedge effect is UNVERIFIED)

### F5

- Severity: medium
- Lens: Backend (config reports an unapplied mode)
- Current: `src/adapter.ts:625` sets `live.mode = mode` before the extension replies. `src/adapter.ts:630-639` reads `readModes(reply)` and `noticeText(reply)` and never checks `reply.error`. `src/extension/index.ts:157-164` replies `{ error: result.diagnostic }` or `{ error: result.veto }`.
- Gap: An error reply is treated as success. The adapter records the vetoed mode as active.
- Failure/impact: `session/set_config_option` returns `currentValue: "edit"` although the extension vetoed it. The adapter's state now diverges from pi. `src/adapter.ts:644-648` re-sends the vetoed mode to every new socket.
- Reproduction: Fake pi with `set-mode` replying `{"error":"mode veto: edit blocked"}`. Result: `"currentValue":"edit"` with the veto text dropped.
- Fix (minimal): In `setConfig`, if the reply has a string `error`, throw an RPC error and set `live.mode` only after success.
- Confidence: high

### F6

- Severity: medium
- Lens: Backend (error shape, params validation)
- Current: `src/adapter.ts:157-163` `rpcError` returns a plain object, not an `Error`. `src/main.ts:114` maps the error with `error instanceof Error ? error.message : String(error)`. `src/adapter.ts:283` `initialize(params)` and `src/adapter.ts:250-276` pass `params` through with no guard.
- Gap: Every adapter-thrown RPC error reaches the client as `message: "[object Object]"`. Missing params fall through to `-32603` with the raw TypeError text.
- Failure/impact: Clients cannot show why a request failed. A `session/prompt` with an unknown session returns `-32602` and `[object Object]`.
- Reproduction (in-process, `main()` with PassThrough streams): `session/prompt` with unknown session gave `{"code":-32602,"message":"[object Object]"}`. Unknown method gave `-32601` with `[object Object]`. `initialize` with no params gave `-32603` with `Cannot read properties of undefined (reading 'clientCapabilities')`.
- Fix (minimal): Make `rpcError` return `class RpcFailure extends Error { code }`. In `main.ts`, read `code` and `message` from it. Default `params` to `{}` in `handle`.
- Confidence: high

### F7

- Severity: medium
- Lens: Robustness (stdout/stdin framing)
- Current: `src/main.ts:149`, `src/pi-rpc.ts:43` and `:66`, `src/socket.ts:109` each call `chunk.toString("utf8")` on every chunk independently.
- Gap: A multi-byte UTF-8 character that spans two chunks decodes to U+FFFD on both sides. No parse error is raised.
- Failure/impact: A prompt, an `acp_write` or `acp_edit` payload, or tool output with a multi-byte character on a chunk boundary is silently corrupted. The file tools write the corrupted text to disk.
- Reproduction: `LineSplitter` (`src/acp.ts`) with the input `{"jsonrpc":"2.0","id":5,"method":"€x"}` split after the first byte of `€`. Output: `"method":"���x"`.
- Fix (minimal): Use `StringDecoder` per stream, or call `setEncoding("utf8")` on each stream.
- Confidence: high for the mechanism. How often real pipe chunks split a character is UNVERIFIED.

### F8

- Severity: medium
- Lens: Robustness and performance (output limits)
- Current: `src/extension/tools.ts:176-179` `execFile("bash", ...)` with the Node default `maxBuffer` (1 MiB). `src/extension/tools.ts:448` `runBinary("fd", ...)` uses the runtime default (`packages/runtime/src/exec.ts:25`, `DEFAULT_MAX_BUFFER = 1024 * 1024`).
- Gap: Whole stdout is buffered. Hitting the cap raises an error and discards output, even when the command exited 0 or when only a few results were requested.
- Failure/impact: `acp_fd` with `max_results: 5` fails in a directory with about 20k matches. `acp_bash` with `head -c 1200000` fails although it succeeded.
- Reproduction: Created 20,000 files in `/tmp`. `acp_fd` threw `fd failed: stdout maxBuffer length exceeded`. `acp_bash` with a 1.2 MB command threw `command failed: stdout maxBuffer length exceeded`.
- Fix (minimal): For `fd`, pass `--max-results` to the binary and drop the mtime sort, or raise the cap. For bash, stream output and truncate with `truncateText` as it arrives.
- Confidence: high

### F9

- Severity: medium
- Lens: Robustness (terminal)
- Current: `src/client-requests.ts:154-157` returns `exitCode` only when the client sends a number. `src/extension/tools.ts:241` checks `typeof state.exitCode === "number"`. `src/extension/tools.ts:221` sets the deadline from `TERMINAL_TIMEOUT_MS` (`tools.ts:22`, 60 s).
- Gap: A command ended by a signal sends `exitStatus: { exitCode: null, signal }`. That never matches the number check.
- Failure/impact: A signal-killed command is reported as "command timed out" after 60 s. The kill and release calls then run against an exited process.
- Reproduction: `readClientTerminal` with `exitStatus: { exitCode: null, signal: "SIGKILL" }` returned `exitCode` of type `undefined`. The 60 s wait itself was not timed (the loop is confirmed by reading).
- Fix (minimal): Map `exitStatus.signal` into the result. In `runTerminal`, throw `command killed by <signal>` right away.
- Confidence: high for the mapping. Wall-clock stall is UNVERIFIED.

### F10

- Severity: low
- Lens: Performance (terminal polling)
- Current: `src/extension/tools.ts:237-249` polls `terminal-output` every 400 ms. `src/client-requests.ts:136-158` returns the whole output buffer on every call.
- Gap: The spec has a "Waiting for exit" method (terminals page). The adapter polls instead and resends the cumulative output each time.
- Failure/impact: Bytes moved over the socket grow with polls times output size. For 1 MB of output over 60 s, the estimate is about 75 MB of JSON (computed, not measured).
- Fix (minimal): Call `terminal/wait_for_exit`, then read `terminal/output` once.
- Confidence: medium (estimate UNVERIFIED)

### F11

- Severity: low
- Lens: UI (content this server sends)
- Current: `src/adapter.ts:570-573` (replay) and `src/adapter.ts:859-864` (live) send `title: name, name, kind, status`. `src/adapter.ts:867-875` sends `tool_call_update` with only `status: "in_progress"`.
- Gap: The spec's `tool_call` fields are `toolCallId, title, kind, status, content, locations, rawInput`. `name` is not one of them. `title` is the raw tool id (`acp_bash`). No `locations` or `rawInput` are sent.
- Failure/impact: The client shows "acp_bash" with no command or path. Each tool update repeats an in-progress status with nothing new.
- Fix (minimal): Build `title` from the command or path. Send `locations: [{ path }]` for read, write, and edit. Drop `name`. Skip status-only updates when the status is unchanged.
- Confidence: high for the field list. Rendering in a real client is UNVERIFIED. Whether pi's `tool_execution_start` carries the arguments is UNVERIFIED.

### F12

- Severity: low
- Lens: Backend (lifecycle)
- Current: `src/main.ts:148-150` listens to `data` only. There is no `end` or `close` handler.
- Gap: Shutdown on client disconnect depends on the child exiting by itself.
- Failure/impact: Real `pi --mode rpc` exits within about 24 ms of stdin EOF. Cleanup then runs through `proc_exit` to `closeSession` (`src/adapter.ts:979-996`), so the adapter exits too. A child that ignores EOF keeps the adapter and child alive. In a stub child that ignores EOF, both stayed alive for 2.5 s.
- Reproduction: Real pi: `get_state` answered, stdin closed, exit code 0 after 24 ms. Stub pi with `setInterval`: adapter and child alive after EOF.
- Fix (minimal): `input.on("end", shutdown)` in `main.ts`.
- Confidence: medium

### F13

- Severity: low
- Lens: Robustness (RPC child)
- Current: `src/pi-rpc.ts:105-115` `request()` adds to `pending` after `failAll` has already run on exit. There is no exited flag.
- Gap: A request sent after the child exited never settles.
- Failure/impact: No current production path reaches it, because `proc_exit` closes the session synchronously (`src/adapter.ts` `piEvent` to `closeSession`). A future caller holding a stale reference would hang.
- Reproduction: `PiRpc.spawn("sh", ["-c", "exit 0"])`, wait for exit, then `request("get_state")`. Neither resolve nor reject was printed.
- Fix (minimal): Track `exited` in `PiRpc`. Reject in `request()` when set.
- Confidence: high

### F14

- Severity: low
- Lens: Robustness (backpressure)
- Current: `src/main.ts:40` `output.write(encodeMessage(value))` ignores the return value and never waits for `drain`.
- Gap: Writes queue in memory with no bound.
- Failure/impact: If the client stops reading stdout while large `session/update` payloads keep coming, memory grows. Magnitude UNVERIFIED.
- Fix (minimal): Await `drain` when `write` returns false.
- Confidence: medium (mechanism certain, size UNVERIFIED)

### F15

- Severity: low
- Lens: Simplicity (dead code, duplicate seams)
- Dead or test-only:
  - `src/acp.ts:37` `decodeLine`: used only by `src/acp.test.ts:2,12,16`.
  - `src/acp.ts:27-31` `PARSE_ERROR`, `INVALID_REQUEST`, `INVALID_PARAMS`, `INTERNAL_ERROR`: no production use. The adapter uses the literals `-32602` and `-32603`.
  - `src/acp.ts:8-25` `RpcNotification`, `RpcResponse`, `RpcError`: no references.
  - `src/pi-rpc.ts:59-68` `fromStreams`: used only by `src/pi-rpc.test.ts:14`.
  - `src/pi-rpc.ts:127-133` `newSession`, `switchSession`: no caller. `src/adapter.ts:373` uses `pi.request("new_session")`.
  - `src/extension/client.ts:44-60` `connectSocket` and `SocketClient`: used only by `src/extension/client.test.ts:2,27`. `src/extension/index.ts:121-150` reimplements the connection in `connectAdapter`.
  - `src/extension/client.ts:11` `REQUEST_TIMEOUT_MS`: no production use. `tools.ts:21` defines its own.
  - `src/extension/index.ts:77`: `await import("../socket.js")` inside `callSocket`, although `index.ts:16` already imports from that module statically.
  - `src/main.ts:33` `void argv`: unused parameter.
- Duplicated:
  - `src/socket.ts:21` `encodeWire` duplicates `src/acp.ts:33` `encodeMessage`.
  - `SOCKET_ENV` and `CAPS_ENV` appear in `src/pi-rpc.ts:5-6` and `src/extension/client.ts:9-10`.
  - `ClientCaps`: `src/adapter.ts:45` and `src/extension/client.ts:18`. `ModeDescriptor`: `src/adapter.ts:32` and `src/extension/index.ts:113`.
  - Wire transport: `src/socket.ts` (`RequestTracker`, `attachWireHandler`, `sendWireRequest`) overlaps `packages/runtime/src/socket.ts:89` (`startJsonlServer`) and `:173` (`requestJsonl`). This was not checked for wire compatibility (UNVERIFIED).
  - `src/sessions.ts:34` in-place write vs `packages/runtime/src/state.ts:83-90` atomic write. See F2.
  - `src/extension/tools.ts:170-190` `localBash` vs `packages/runtime/src/exec.ts:37` `runCapture`. The runtime path handles `maxBuffer` and signal kill, and the local copy does not share them. See F8.
  - Two timeout layers for the same client call: `src/client-requests.ts` `withTimeout` and the `timeoutMs` argument in `src/main.ts:46`.
- Test restating implementation: `src/acp.test.ts:12` checks `decodeLine(encodeMessage(x))` equals `x`, which restates JSON round-tripping.
- Confidence: high (grep of non-test references)

## Failure modes

- Adapter killed by SIGKILL or OOM: pi children survive. Observed in probe runs: after SIGKILL of the adapter, stub pi children stayed alive, reparented (ppid changed). Nothing in `main.ts` or `pi-rpc.ts` kills children from a dead parent. Whether real pi exits on pipe loss is UNVERIFIED.
- SIGTERM and SIGINT: `shutdown` closes every session and kills children. Observed: one child before, zero after. Clean.
- `pi` binary missing: `session/new` returned `-32603` with `spawn pi ENOENT`, and the adapter stayed up. Clean.
- `loadSession` closes the live session (`src/adapter.ts:478`) before the new pi starts. If the new start fails, the session is gone in memory but still in the store.
- `pi.abort()` has no timeout (`src/adapter.ts:600`). If pi never acknowledges, `session/cancel` never returns.
- `pendingPrompts` is FIFO and assumes exactly one `agent_settled` per accepted prompt (`src/adapter.ts:900`). A second `session/prompt` while a turn runs is forwarded without a guard (`src/adapter.ts:913-970`). Real pi behavior is UNVERIFIED.
- Local writes in `acp_write` and `acp_edit` are in place (`src/extension/tools.ts:320`, `:373`). A crash mid-write truncates the file.
- Socket path is predictable (`src/adapter.ts:299-305`, `hollowheap-acp-<pid>-<seq>.sock` in `tmpdir`). The socket file's mode follows the umask. No exploit was attempted.
- Path containment for client fs calls: the policy layer resolves symlinks with `realpathSync` (`packages/core/src/policy.ts:45`), and `runPolicy` runs before every fs call. Checked; no finding.

## Seams

- Client (stdio JSON-RPC) to adapter: `src/main.ts`. Framing, error mapping, and the request/response table live here. This is where F1, F6, F7, and F12 sit.
- Adapter to pi child: `src/pi-rpc.ts` over child stdio. Framing and lifecycle. Covers F2, F13, and the stdout-only contract (non-JSON lines dropped at `src/pi-rpc.ts:73-77`, which is correct).
- Pi child extension to adapter: a Unix socket with JSONL (`src/socket.ts`, `src/adapter.ts:299-340`). The adapter trusts any `method` on it and does not check the caller beyond socket file permissions. Overlaps `packages/runtime/src/socket.ts`.
- Adapter to client capabilities: `src/client-requests.ts` (fs, terminal, permission). Timeouts and cancellation are inconsistent (F4, F9).
- Extension tools to policy: `packages/core` `evaluate` and `checkPath`. Used consistently before each action.

## Rejected defaults

- `protocolVersion: 1` fixed (`src/adapter.ts:286`). Version 1 is the only one in use. No negotiation is needed yet.
- SIGTERM as the default kill signal for children (`src/pi-rpc.ts:40`). No escalation to SIGKILL. A child that ignores SIGTERM is not observed.
- `touch()` rewrites the whole store on every prompt and `agent_settled` (`src/adapter.ts:428-434`). Store size is small, and no timing was measured. Micro-optimization without evidence.
- Linear owner lookup per socket message (`src/adapter.ts:315`, `:331`). Typical session count is one per adapter, so no measured cost.
- 400 ms terminal poll interval (`src/extension/tools.ts:249`). Default. The real issue is F10.
- 10 s fs and terminal request timeout (`src/client-requests.ts`). Confirmed by probe: a client that never answers `fs/read_text_file` fails after 10,000 ms.
- `process.exit(0)` in the shutdown handler without awaiting children (`src/main.ts:151-154`). Children are sent SIGTERM first. Acceptable.
- Forwarding pi stderr to the adapter's stderr with a `[pi]` prefix (`src/pi-rpc.ts:44-47`). Stderr is not part of the protocol.
- No ACP SDK. The server hand-rolls JSON-RPC, and no SDK default was available to adopt.

## Open Questions

1. Does real pi's `abort` end a turn while a tool awaits `askPermission` (`src/extension/tools.ts:99`)? This decides whether F4 is a lockout or a leak.
2. Does real pi queue or reject a `prompt` sent while a turn is running? This decides whether the `pendingPrompts` FIFO (`src/adapter.ts:900`) can misattribute `agent_settled`.
3. Permission timeout policy. Expire to `reject_once`, or wait for the user indefinitely? This is a UX decision, not a code fact.
4. Should the adapter kill children when it is SIGKILLed? Options: a watchdog on the stdin pipe, or accept the limitation and document it.
5. Is the Unix socket wire format (`src/socket.ts`) meant to stay separate from `packages/runtime/src/socket.ts`? If it is not, F15's duplicate seam should be removed.

## Verdict

fail

Blocking: F1 (cancel from a spec client is a no-op), F2 (malformed local store crashes the server), and F3 (edit and write guards fail open on read errors). The fixes for these three are small and local to `main.ts`, `sessions.ts`, `adapter.ts`, and `extension/tools.ts`.
