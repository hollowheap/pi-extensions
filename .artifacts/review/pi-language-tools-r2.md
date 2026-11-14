# Review — pi-language-tools re-review (V26)

## Scope

- Paths: `extensions/pi-language-tools/{index.ts,src/index.ts,src/lsp.ts,src/tool.ts,src/config.ts}` (~2069 LOC incl. tests and fixtures). Tests and `fixtures/fake-lsp.mjs` were read only for coverage.
- Commit: a035b03 (`fix(pi-codemode): keep codemode-only tools off the model surface`). Recent slice commits: 64d4b84 (V07-F03 seam removal), 64c6f9f, ed74637, 98f1994, 615d205.
- Lenses: robustness, backend, UI, performance, simplicity.
- Prior review: `artifacts/review/pi-language-tools.md` (V07), including its Resolution (2026-10-30) and Resolution (2026-11-04).
- Shared packages (V20 tui, V21 runtime, V22 core) were not re-reviewed. Only slice usage of them is noted.
- Baseline (from the request, not re-run): `npm test` 1052/1052, typecheck and lint clean.
- Probes ran in `/tmp` against a copy of `src/lsp.ts` (Node v24.21.0) with a fake LSP server. The probe directory was deleted afterward.

## Prior resolutions

- V07 pool LRU refresh and busy-skip eviction: holds (`lsp.ts:706-718`, `lsp.ts:720-727`).
- V07 `disposeAllLspClients` drains in a loop: holds (`lsp.ts:732-738`).
- V07 request timeout rejects only that request and sends `$/cancelRequest`: holds (`lsp.ts:478-491`). Its side effect is finding F1: a timed-out request no longer tears down a stuck client.
- V07 startup rejection through `startReject`: holds (`lsp.ts:417-443`, `lsp.ts:265-269`, `lsp.ts:661-663`).
- V07 unknown action returns text: holds (`tool.ts:689-691`).
- V07 `loadConfig` failures returned as text: holds (`tool.ts:736-744`).
- V07 session disposal promises handled: holds (`index.ts:16`, `index.ts:37`).
- V07 `effectiveCwd` for display and `ctx.cwd` for boundary and LSP root: holds (`tool.ts:704-705`, `tool.ts:709`, `tool.ts:759`).
- V07 `LangClient` and `FormatContext` removed: holds (`tool.ts:32-40` returns the concrete `LspClient`; no remaining references).
- V07 config cache on core `MtimeCache`: holds (`config.ts:3`, `config.ts:34`).
- V07 codemode-only exposure: holds (`tool.ts:618` `exposure: "codemode"`; `index.ts:23-30` swaps `lang` for `codemode`).
- V07 added read-only actions: holds (`tool.ts:42-55`, `tool.ts:620-630`). No edit or rename action exists.

Regressed prior resolutions: 0.

## Findings

### F1 — high — Robustness (frame parsing and timeouts) — lockout

- Current: `lsp.ts:567-585`. `onData` has no upper bound on `Content-Length` (`lsp.ts:580-582` waits for `bodyStart + length` bytes). `lsp.ts:478-491` times out a request but leaves the client open, and nothing calls `fail()` on timeout.
- Gap: a frame that declares more bytes than the server sends keeps the parser waiting. Later valid responses are consumed as body bytes. Timeouts never escalate to a restart.
- Failure/impact: every later request on that pooled client times out until the session ends (`session_shutdown` or `session_start`, `index.ts:16`, `index.ts:37`). The `lang` tool is unusable for the session.
- Reproduction: fake server answers `initialize`. On `textDocument/definition`, it writes `Content-Length: 100000\r\n\r\n` followed by a 36-byte JSON response, then answers nothing else. Client `timeoutMs: 500`. Three `definition()` calls: timeouts at 562 ms, 501 ms, 502 ms. `client.disposed` stays `false`.
- Fix (minimal): reject `Content-Length` above a cap (for example 64 MiB) with `fail()`. Also call `fail()` after two consecutive request timeouts on one client, so the pool replaces it.
- Confidence: high for the mechanism (probed). Trigger requires a server that writes an inconsistent frame, so likelihood is low.

### F2 — high — Robustness (process lifecycle) — orphan

- Current: `lsp.ts:405-410` spawns without `detached`, so the server is not its own process group. `lsp.ts:304-311` sends `child.kill()` (SIGTERM) and then repeats the same `child.kill()`, which is not an escalation. `lsp.ts:677` does the same in `fail()`.
- Gap: only the direct child receives a signal. Grandchildren (for example a server that spawns a worker) are not signalled, and a server that ignores SIGTERM is never force-killed. The runtime package already provides this: `spawnDetachedProcess` (`packages/runtime/src/process.ts:84`, sets `detached: true` at `:94`) and `cancelProcessGroup` (`packages/runtime/src/process.ts:173-186`, SIGTERM then SIGKILL on the group).
- Failure/impact: `dispose()` and `fail()` leave processes running. Each `/reload` or new session leaves more of them.
- Reproduction (probed):
  - Server `sh -c "sleep 300 & wait"`, then `dispose()`. The `sh` exits, but `sleep 300` is still running after dispose (`ps -eo pid,args`).
  - Server `sh -c "trap '' TERM; sleep 300 & wait"`, then `dispose()`. dispose took 352 ms. The server pid is still alive afterward.
- Fix (minimal): spawn with `detached: true`. On dispose and fail, call `process.kill(-pid, "SIGTERM")`, wait the grace period, then `process.kill(-pid, "SIGKILL")`. Or use `cancelProcessGroup` from `@hollowheap/runtime/process` and drop the local kill code.
- Confidence: high (probed). Side effect to confirm: `detached` stops terminal Ctrl-C from reaching servers. Pi's own shutdown then has to dispose them.

### F3 — medium — Robustness (cancellation) — wrong behavior

- Current: `tool.ts:670-672` takes `_signal` and never uses it. `lsp.ts:314-324` `enqueue` runs all requests one at a time, so a queued call waits behind the in-flight call.
- Gap: a cancelled or abandoned tool call still occupies the queue until its own timeout (10 s default, `config.ts:6`, up to 60 s, `config.ts:7`).
- Failure/impact: a hung server blocks every later `lang` call for one full timeout each.
- Reproduction (probed): fake server never answers `definition`, `timeoutMs: 1500`. Call A and call B are issued together. A rejects at 1562 ms. B rejects at 3065 ms, having waited for A.
- Fix (minimal): pass `signal` into `enqueue`. Reject queued tasks on abort without running them. On abort of an in-flight request, send `$/cancelRequest` and reject it, as the timeout path already does.
- Confidence: high.

### F4 — medium — Robustness (stale results) — wrong behavior

- Current: `lsp.ts:629-640` resolves `diagnostics()` on the first `publishDiagnostics` for the URI. It ignores `params.version`. The version sent by `syncDocument` is at `lsp.ts:557-562`.
- Gap: the waiter cannot tell an old or partial publish from the answer to the latest change. Pull mode (`lsp.ts:236-241`) avoids this, but push-only servers use the path.
- Failure/impact: `diagnostics` returns an incomplete or stale list. The model sees "No diagnostics" for a file with errors.
- Reproduction (probed): fake server publishes `[]` immediately on `didOpen` and on each `didChange`, then sends a `semantic error` publish 50 ms later. `diagnostics()` returns `[]` on the first call and again after an edit. The semantic error is never returned.
- Fix (minimal): ignore publishes whose `version` is missing or below the version sent. Or keep waiting for a short quiet period after the first publish.
- Confidence: medium. The mechanism is probed. Whether real servers (for example typescript-language-server) publish in two phases is UNVERIFIED.

### F5 — medium — Backend (output bounds) — context exhaustion

- Current: `tool.ts:382-398` (`formatHover`) and `tool.ts:407-449` (`formatSignatureHelp`) return server text without a cap. `tool.ts:805-807` and `tool.ts:815-822` pass it to `textResult` (`tool.ts:569-575`). `formattedResult` (`tool.ts:921-935`) applies the `max_results` cap only to list actions.
- Gap: `max_results` does not bound hover or signature help text, and no character limit exists.
- Failure/impact: one hover on a generated type can put a very large string into model context.
- Reproduction: code path. A fake server returning 1 MB of `hover.contents.value` would return all of it. Size in practice is UNVERIFIED.
- Fix (minimal): cap hover and signature text (for example 8 KB) with the same `... (truncated)` suffix used by `formattedResult`.
- Confidence: high for the code path.

### F6 — medium — Performance (server lifecycle) — per-call spawn after failure

- Current: `lsp.ts:710-712` returns a pooled client only if `!existing.disposed`. A failed client is removed by `onExit` (`lsp.ts:716-718`), so the next call creates a new one. `lsp.ts:384-387` bounds initialize by `timeoutMs`, and `fail()` at `lsp.ts:656-679` kills the process.
- Gap: no backoff or negative cache for a server that fails to start or hangs during initialize.
- Failure/impact: each `lang` call spawns a process and waits the full timeout (10 s default) before failing.
- Reproduction (probed for the first call): server never answers `initialize`, `timeoutMs: 1000`. The call rejects with "initialize timed out after 1000ms" and the client is disposed. A second `getLspClient` call with the same options creates a new client, which means a new spawn.
- Fix (minimal): record `(key, failedAt, error)` on startup failure. For about 30 s, return that error immediately without spawning.
- Confidence: high for the mechanism. Impact depends on how often a user calls a broken server.

### F7 — low — Simplicity (dead members, duplicated shapes)

- `lsp.ts:103-105` `get pid()` has no consumer in the repository (`rg "\.pid"` finds only `process.pid` at `lsp.ts:369`). Delete it.
- `lsp.ts:24-35`: `PendingDiagnostics` has the same shape as `PendingRequest`. Use one type.
- `lsp.ts:6-7` duplicates `config.ts:6-7` (`DEFAULT_TIMEOUT_MS`, `MAX_TIMEOUT_MS`). `lsp.ts:49-50` clamps silently while `config.ts:172-182` rejects invalid values. Keep one policy and import the constants.
- `lsp.ts` has ten public methods (`definition` through `diagnostics`) with the same `enqueue`, `ensureInitialized`, `syncDocument`, `request` body. One private helper would replace them.
- Confidence: high.

### F8 — low — UI (collapsed preview) — rows exceed the preview

- Current: `tool.ts:666-668` shows the first 8 logical lines. The `Text` component wraps to terminal width (`node_modules/@earendil-works/pi-tui/dist/components/text.js:60`).
- Gap: the 8-line cap counts logical lines, not rendered rows.
- Impact: one long hover line produces dozens of rows in collapsed view.
- Reproduction (probed): `new Text("a".repeat(3000) + "\n...", 0, 0).render(80)` returns 46 rows for 9 logical lines.
- Fix (minimal): truncate each line to the width, or slice the rendered rows instead of the logical lines.
- Confidence: high.

### F9 — low — Backend (diagnostic text) — stderr enters model output

- Current: `lsp.ts:681-687` (`describe`) appends the last 4096 bytes of server stderr (`lsp.ts:7`) to every error. `tool.ts:917` returns it to the model as `lang: <message>`.
- Gap: stderr is not redacted or limited to the first lines. Servers may log paths or environment details.
- Impact: server log content, which may include secrets, reaches model context on each error.
- Reproduction: code path. Content of real server stderr is UNVERIFIED.
- Fix (minimal): keep only the first 512 bytes of stderr in the returned message, and log the rest only in a debug channel.
- Confidence: medium.

## Failure modes

- Stdin write after the server closes its stdin: `child.stdin` has no `error` listener (`lsp.ts:405-460`). A write to a closed pipe emits an unhandled `error` event, which could crash the host. A probe where the server closed stdin at startup and the client wrote 500 ms later did not crash, so the crash is not reproduced (see Open Questions).
- Pool key ignores `timeoutMs` and `name` (`lsp.ts:702-704`). Two server entries with the same command, args, and root share the first client's timeout. Low likelihood.
- `didOpen` documents are never closed (`lsp.ts:552-562`). The `documents` map grows with each file touched during a session, and the server holds those documents.
- `session_shutdown` disposal is fire-and-forget (`index.ts:36-38`). If the host exits before the 250 ms plus 100 ms grace (`lsp.ts:301-309`), servers are left running with only stdin EOF to stop them. Host exit behavior is UNVERIFIED.
- Empty-query `workspace_symbols` makes the server return every symbol. `tool.ts:341-380` caps only the printed lines, so the full response is buffered and parsed first. Expected repo size is not stated, so cost is unmeasured.
- Per-request `readFileSync` (`lsp.ts:542`) and `statSync` (`tool.ts:718`) run on the request path. Reads are small and this is unmeasured. Rejected as a micro-optimization.
- Frame buffering with no header terminator (`lsp.ts:570-571`) grows without limit. Same root cause as F1.

## Seams

- `lsp.ts:405-460` and `lsp.ts:656-679` reimplement spawn and kill. `packages/runtime/src/process.ts:84` and `:173` own detached process groups and escalation, and the runtime package is the documented owner of command execution (`AGENTS.md`, Repository Layout). Using it fixes F2 and removes the duplicate seam.
- `lsp.ts:706-740` keeps its own pool on `globalThis` via `Symbol.for`. This is intentional so pools survive `/reload`. The seam is justified, but the pool and the disposal path in `index.ts` should be the only callers.
- `tool.ts:32-40` `LangToolDeps` is a test-injection seam used by `createLangTool`. It has one production adapter, which is acceptable.
- Clamp and default policy is split between `lsp.ts:6-7, 49-50` and `config.ts:6-7, 171-182` (F7).
- Result clamps: `tool.ts` uses `clampMaxResults` from `@hollowheap/runtime/exec` (`packages/runtime/src/exec.ts:28-31`). Correct use of the shared package.

## Rejected defaults

- Request timeout 10 s default and 60 s maximum (`config.ts:6-7`): user-tunable per server (`config.ts:171-182`).
- Pool cap of 32 (`lsp.ts:10`): required by R19 in V07.
- `max_results` default 100 and maximum 500 (`tool.ts` schema; `packages/runtime/src/exec.ts:28-31`): intended.
- `process.env` passed to servers (`lsp.ts:409`): servers run project code, which is gated by `ctx.isProjectTrusted()` (`tool.ts:693`). Intended.
- Outside-workspace and symlink reads: `packages/core/src/policy.ts:163-168` resolves real paths and denies anything outside the root. Holds.
- Clients disposed on every `session_start` (`index.ts:16`): by design. Cost is one respawn per session.
- Collapsed preview of 8 logical lines: design. Row count is F8.
- `exposure: "codemode"` (`tool.ts:618`): intended by a035b03.

## Open Questions

1. Should `lang` honor the user's abort (Esc) at all, or is queueing behind a hung server acceptable? This decides the scope of F3.
2. Does the host await `session_shutdown` handlers before exiting? This decides whether F2 also leaves servers running on pi exit.
3. Does the host ever write to a server stdin that is already closed? The missing `error` listener (`lsp.ts:405-460`) needs a reproduction that the probe did not produce.
4. Do the target language servers publish diagnostics in more than one phase? This sets the severity of F4.

## Verdict

fail

Two high findings are evidenced by probe: F1 (a pooled client wedges for the session after a bad frame) and F2 (`dispose()` leaves server processes and their children running). Both have small fixes, and F2 can reuse `cancelProcessGroup` from `packages/runtime/src/process.ts:173`.
