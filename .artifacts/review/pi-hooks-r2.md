# Review — pi-hooks (V37, robustness re-review of V06)

Reviewer: diff auditor (read-only). Source, tests, and config were not edited. Probes ran from `/tmp` and were deleted. The uncommitted `extensions/pi-agent` change was ignored.

## Scope

- Slice: `extensions/pi-hooks/src/{config,hooks,index}.ts` (about 592 LOC including `index.ts` and `hooks.ts`), tests, README, and `src/skills/hooks-init/SKILL.md`.
- Prior review: `artifacts/review/pi-hooks.md` (V06).
- Recent commits touching the slice: `615d205`, `98f1994`, `e68aa50`, `ed74637`, `64c6f9f`, `39d3b6c` (V06-F02 cache fix).
- Host: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/{types.d.ts,runner.js}`.
- Runtime seam: `packages/runtime/src/exec.ts`. Already-reported V21 items F2 and F3 are cited only for impact.
- Checks: `npx vitest run extensions/pi-hooks` gives 3 files, 46 tests, all passing.
- Probes: `loadHooks`, `runPreHook`, `evaluateCondition` loaded through jiti from `/tmp`. Results below are the observed output.

## Prior resolutions

Each line is V06 resolution → status at HEAD.

1. Regex conditions match whitespace → holds (`hooks.ts:44`, `:46`, `:49`).
2. Malformed conditions evaluate false instead of fail-open → holds as written (`hooks.ts:54`). The result still fails open for a blocking pre-tool hook; see V37-F2.
3. Non-object tool input normalized to `{ value }` → holds (`index.ts:47-52`, `:63`).
4. Post-tool notifications guarded against missing UI → holds (`index.ts:69-76`).
5. Pre-tool setup failure blocks; post-tool failure warns → holds (`index.ts:121-127` block; `index.ts:171-176` warn).
6. Chained `previousOutput` cleared after failure or no output → holds (`index.ts:151`, `:154`).
7. Cached diagnostics once per `onDiagnostic` callback → holds (`config.ts:56-63`, callback reuse at `index.ts:30-37`).
8. Module-global cache cleared on session shutdown → holds (`index.ts:179-181`).
9. 2026-11-04 switch to core `MtimeCache` → holds (`config.ts:3`, `:187`); no local cache or `mtimeMs` map remains.

Regressed prior resolutions: 0.

## Cross-slice impact (V21, packages/runtime)

- F2 (timeout/abort kills only the direct child). Probe: `runPreHook` with `sh -c "sleep 20 & sleep 20"` and `timeoutMs: 1000` returned in 1009 ms with `block: true`. Two `sleep 20` grandchildren were still alive afterward, so each timed-out pre-tool hook can leave orphan processes. The tool call is not held past the timeout in this case. Abort is a separate gap (V37-F3).
- F3 (argv in error text). The block reason reaches the host verbatim: `{"block":true,"reason":"sh failed: Command failed: sh -c sleep 20 & sleep 20"}`. The path is `hooks.ts:127-131` → `index.ts:117`. Any argument carrying a token (for example `--token=…`) lands in the reason. Impact only; not re-reported.

## Findings

Format: ID | Severity | Lens | Current file:line and snippet | Gap | Failure/impact | Reproduction | Fix | Confidence.

### V37-F1 | high | Lens 1 (security)

- Current: `hooks.ts:115` `return runCapture(entry.command, entry.args, payload.cwd, undefined, {` and `config.ts:81` `const command = record.command;` (no path check).
- Gap: `execFile` resolves a relative command containing `/` against `cwd`. `payload.cwd` is the project directory. A hook from the trusted agent-dir file (`hooks.json` under `getAgentDir()`) with `"command": "./scripts/guard.sh"` therefore executes a file controlled by an untrusted project. The trust gate only covers `.pi/hooks.json` (`config.ts:196-197`), not the file a trusted hook points to.
- Failure: With `trusted: false`, a project file runs on every matching tool call. The project can run code without the user's consent. The gate reports "project is not trusted", so the user has no signal.
- Reproduction: Probe in `/tmp/pihk-probe/case`. Project contains `scripts/guard.sh` (writes a marker file). Agent dir contains `{"hooks":{"preTool":[{"matcher":"bash","command":"./scripts/guard.sh"}]}}`. `loadHooks({trusted:false, workspaceRoot: proj, ...})` returned the entry, diagnostics were `[]`, and `runPreHook(..., cwd: proj)` returned `{"block":false}` with the marker created.
- Fix: In `parseEntry`, reject non-absolute commands that contain a path separator, or resolve them against the directory of the file that defined them (`agentDir`) instead of the effective cwd. Add a test that an untrusted project cwd does not change which file runs.
- Confidence: high (probe reproduced).

### V37-F2 | high | Lens 1 (fail-safe) and Lens 2 (backend)

- Current: `hooks.ts:44-54` returns `false` for any unrecognized condition. `config.ts:111-112` stores any string as `condition` without validation. `index.ts:109-111` filters hooks with `evaluateCondition`.
- Gap: A malformed condition on a `preTool` hook skips that hook. The tool call then proceeds. No diagnostic is produced.
- Failure: A guard such as `{"matcher":"bash","condition":"tool = 'bash'","command":"check-branch"}` never runs. The tool is allowed silently. This contradicts the requirement that a blocking hook fails safe.
- Reproduction: Probe with `condition: "tool = 'bash'"`. `evaluateCondition` returned `false`, `loadHooks` loaded 1 entry, diagnostics were `[]`.
- Fix: Validate `condition` in `parseEntry` against the two supported grammars. Emit a diagnostic on failure and drop the entry, or for `preTool` treat an unparseable condition as a match, which blocks by way of the hook itself.
- Confidence: high (probe reproduced).

### V37-F3 | medium | Lens 1 (cleanup on shutdown and /reload)

- Current: `hooks.ts:115` passes `undefined` as the signal. `index.ts:108-118`, `:133-150`, and `:83-95` never pass `ctx.signal`. Host `types.d.ts:240` exposes `signal: AbortSignal | undefined` on the context.
- Gap: Hooks ignore abort. `session_shutdown` (`index.ts:179-181`) only clears the cache.
- Failure: Aborting a turn or reloading the extension does not stop a running hook. Pre-tool hooks run sequentially (`index.ts:113-118`), so the wait is the sum of their timeouts (default 10000 ms, `config.ts:32`). A hook blocking a call with `timeoutMs: 60000` keeps the agent waiting for up to 60 s after abort.
- Reproduction: Static trace only (not run against the host). Configure `preTool` with `sh -c "sleep 30"` and `timeoutMs: 60000`, trigger a bash call, then abort. Expected: the process keeps running after abort. `UNVERIFIED` on the host's own abort handling of pending `tool_call` handlers.
- Fix: Pass `ctx.signal` through `runPreHook`, `runPostHook`, `runSessionHook` to `runCapture`. Abort then produces a rejection that the existing catch blocks as fail-safe.
- Confidence: medium (trace is certain; host-side timing is UNVERIFIED).

### V37-F4 | medium | Lens 1 (secrets in env and stdin)

- Current: `exec.ts:64-72` calls `execFile` with `{cwd, timeout, maxBuffer, signal}` and no `env`, so the child inherits all of `process.env`. `hooks.ts:116` sends `JSON.stringify(payload)` on stdin, including the full raw tool `input`. `index.ts:117` puts hook stderr or stdout into `reason`.
- Gap: Every hook receives every environment variable (API keys included) and the raw tool input. Hook stdout and stderr also become the block reason.
- Failure: A hook that echoes its input or environment on error exposes secrets to the block reason, which the host returns to the model as the tool result. The env exposure is by design for trusted hooks, but it is undocumented in `README.md` and `SKILL.md`.
- Reproduction: Probe with `PI_PROBE_TOKEN=s3cret-value` and a hook `printenv PI_PROBE_TOKEN 1>&2; cat 1>&2; exit 2`. The block reason was `"s3cret-value\n{...\"command\":\"curl -H 'Authorization: Bearer abc123'\"...}"`.
- Fix: Document the env and stdin contract. Optionally pass an explicit allowlist env. Truncate reason text before it reaches `index.ts:117`. Do not change defaults without a decision, since hooks may need credentials.
- Confidence: high (probe reproduced).

### V37-F5 | medium | Lens 3 (UI noise)

- Current: `index.ts:146-152` calls `notifyWarning(ctx, ...)` inside the per-tool `tool_result` loop when a post hook fails.
- Gap: Diagnostics for config are deduplicated (`config.ts:56-63`). Hook execution failures are not. The same failure repeats on every matching tool call.
- Failure: A broken postTool hook (for example `npm test` missing) adds one warning per edit call for the whole session.
- Reproduction: Static trace. Configure `postTool: [{"matcher":"edit","command":"false"}]` and run several edits. Each call reaches `index.ts:147`. Not run against the TUI.
- Fix: Deduplicate by `hook.command` plus error text per session, or show one warning per session and log later failures.
- Confidence: high for the trace; severity depends on UI behavior (`UNVERIFIED` on TUI rendering).

### V37-F6 | low | Lens 2 (backend contract)

- Current: `config.ts:13-14` says `"markdown" (default)`. `config.ts:113-114` leaves `format` undefined when unset. `hooks.ts:149` fences output only when `entry.format === "markdown"`.
- Gap: The documented default is not the behavior. Unset format returns raw output.
- Failure: Output that users expect as a code block is injected unfenced into tool results.
- Reproduction: Static trace from `config.ts:113-114` and `hooks.ts:149`.
- Fix: Either default `format` to `"markdown"` in `parseEntry`, or correct the comment to say `"plain"` is the default.
- Confidence: high.

### V37-F7 | low | Lens 2 (backend contract)

- Current: `hooks.ts:91-101` treats exit 0 with empty stdout as allow, exit 0 with JSON `{"decision":"allow"}` as allow, and exit 0 with any other stdout as a block (`"hook printed output that is not a decision"`). Exit codes 1 and 2 block with stderr or exit-code text.
- Gap: The contract is implicit, and it is not written in the README or SKILL.md.
- Failure: A logging hook that prints one line on exit 0 blocks every tool call. The fail-safe is correct, but the user cannot tell why the block happens.
- Reproduction: Probe `sh -c "echo ok"` returned `{"block":true,"reason":"hook printed output that is not a decision"}`. `sh -c "echo '{\"decision\":\"allow\"}'"` returned `{"block":false}`.
- Fix: Document the stdout contract. Consider a dedicated diagnostic message that names the stdout problem.
- Confidence: high.

### V37-F8 | low | Lens 5 (simplicity)

- Current: `index.ts:30-37` keeps a `WeakMap` of callbacks keyed by `ctx.sessionManager`, and `config.ts:40-41`, `:56-63` keep a `WeakSet` of callbacks per cache entry. Also `hooks.ts:4` re-exports `HookEntry` (already exported from `config.ts`), `hooks.ts:21` declares `HookInput` used once (`hooks.ts:113`), and `hooks.ts:73` exports `interpretPreHook` for the test seam only.
- Gap: Two layers deduplicate the same diagnostics. The re-export and the alias add surface without callers.
- Failure: No runtime failure. Maintenance cost: a change to diagnostic delivery has to update both layers.
- Reproduction: Static trace. Deletion test: removing the `WeakMap` at `index.ts:30-37` and passing a single callback per session keeps the V06 behavior tests passing (`UNVERIFIED`, not run).
- Fix: Collapse to one dedupe point. Drop the `hooks.ts:4` re-export and inline `HookInput`.
- Confidence: medium.

## Failure modes

- Timeouts orphan grandchildren (V21 F2). Measured: two `sleep 20` survived a 1 s timeout.
- Abort and reload do not stop hooks (V37-F3).
- Recursion: a hook that runs `pi` starts a child agent that loads the same hooks. No environment marker or depth limit exists in `hooks.ts` or `index.ts`. Chain depth is bounded only by the child's own timeouts. `UNVERIFIED` (not run).
- Post-hook output is wrapped in a Markdown fence (`hooks.ts:149-150`). Output that contains a line of three backticks closes the fence early. Low impact, `UNVERIFIED` rendering.
- Config cache keys on mtime only (`config.ts:185`, signature at `:187`). A rewrite within the same mtime tick serves stale hooks. `UNVERIFIED` on filesystems with coarse mtime.
- Session-start hooks are awaited in sequence (`index.ts:83-95`). Startup delay is the sum of timeouts. `UNVERIFIED` whether the host awaits `session_start`.

## Seams

- Process execution: `hooks.ts:1` and `:115` use `@hollowheap/runtime/exec` `runCapture`. This is the single seam. No duplicate spawn exists in `pi-hooks`. `pi-guard` does not spawn processes.
- Sandbox: `runCapture` supports `sandbox`, but `hooks.ts:115` does not pass it. Enabling it by default is a decision, not a fix.
- Host: `ExtensionAPI` `tool_call` and `tool_result` return shapes match `types.d.ts`. `tool_call` returns `{block, reason}`. Host `emitToolCall` (`runner.js:957-972`) does not catch handler throws. The extension catches all exceptions, so this is covered.
- Config: `loadHooks` is the only config entry point. Its two-file merge is clear.

## Rejected defaults

- Caching `loadHooks` more aggressively: measured 20.8 µs per call on cache hit (`perf` probe, 2000 iterations). No change.
- Spawn cost: 3.87 ms per `true` hook (50 iterations). Per-call spawn is acceptable for a guard. Do not parallelize hooks, because ordering and first-block semantics depend on sequence.
- Stripping env by default: breaks hooks that need credentials or PATH. Document first (V37-F4).
- Defaulting the sandbox on: changes execution for all hooks without a user decision.

## Open Questions

1. Is a relative `command` in the agent-dir file intended to resolve against the project? If yes, V37-F1 becomes a documented trust decision and the fix is to reject the untrusted case.
2. Does the host abort `tool_call` handlers when the agent is aborted? Needed to size V37-F3.
3. Does the host await `session_start` handlers? Needed to size the startup delay.
4. Should a malformed condition on a `preTool` hook block (safe) or skip with a diagnostic (quiet)? V37-F2 assumes block or diagnostic, not silent skip.

## Verdict

Needs changes before the trust and guard guarantees hold. Two high findings (V37-F1, V37-F2) were reproduced. The fixes are small and local to `config.ts` and `hooks.ts`. The skill remains opt-in only: `index.ts:78-80` registers `resources_discover` only when `PI_HOOKS_DISCOVER_SKILL === "1"`, and `SKILL.md` frontmatter sets `disable-model-invocation: true`.
