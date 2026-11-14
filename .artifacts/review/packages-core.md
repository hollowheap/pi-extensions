# Review — packages/core + packages/policy (V22)

## Scope

- Paths: `packages/core/src/*.ts` (policy, config, modes, shell, state, registry, prompt-lock, mtime-cache, session-cache, usage, pricing, format, border, blocks, alerts, workspace), `packages/policy/src/{extension,targets}.ts`, consumers under `extensions/` and `packages/{tui,pi-acp}` found with `rg`.
- Commit: a035b03. Baseline per request: `npm test` 1052/1052, typecheck and lint clean. Not re-run by this reviewer.
- Host reference: `node_modules/@earendil-works/pi-coding-agent/dist/{utils/paths.js,core/tools/path-utils.js,core/tools/edit.js,core/tools/write.js}`.
- Lenses: robustness/security, backend, performance, UI, simplicity.
- Probes: Node v24.21.0 with jiti 2.7.0 importing the TS sources. Scripts lived in `/tmp/v22` and were deleted after use. Repro snippets below use the same calls.
- Prior review: none for these packages. pi-guard V05 Resolution lines reviewed. None of them overlap these findings. V05 covered `tool_call` fail-closed, `isSubpath` root handling, and atomic guard-config writes, all of which are present here.

## Findings

### F1 — `~` and `@` prefixes bypass the workspace boundary in policy path checks

- Severity: high (permission bypass)
- Lens: robustness/security
- Current: `packages/core/src/policy.ts:51-57` resolves the target as `<root>/<path>` with no home or `@` handling:
  ```ts
  const absolute = isAbsolute(path) ? path : ... `${root}${sep}${path}`;
  ```
  `packages/core/src/modes.ts:228` makes this the hard boundary: `const hard = matchPath([], options.target, tag, options.cwd); if (hard.outside) return "deny";`. The host resolves the same argument differently. `utils/paths.js:55-75` (`normalizePath`) strips a leading `@` (`stripAtPrefix`) and expands `~` / `~/` through `homedir()`. `core/tools/path-utils.js:35-44` routes through it. `core/tools/edit.js:94` and `core/tools/write.js:31` call `resolveToCwd`.
- Gap: policy evaluates `~/.bashrc` as the workspace-relative file `<root>/~/.bashrc`, and `@/etc/passwd` as `<root>/@/etc/passwd`. The host then writes or reads the real `$HOME/.bashrc` or `/etc/passwd`. No `.` or `..` check protects these forms because they are inside the root after policy's own resolution.
- Failure/impact: in `edit` mode (`modes.ts` builtin layer, `edit: "allow"`), or with a user `allow edit *` rule, an `edit`/`write` call to `~/.bashrc` is allowed without a prompt. In `ask` mode the call prompts, and the prompt shows the policy target, not the expanded path. Headless children inherit the same evaluator through `packages/policy/src/extension.ts:42-60`.
- Reproduction (verified by probe, cwd `/tmp/v22/ws`, mode `edit`, no rules):
  - `evaluate({tag:"edit", target:"/etc/passwd"})` → `deny`
  - `evaluate({tag:"edit", target:"../../etc/passwd"})` → `deny`
  - `evaluate({tag:"edit", target:"~/.bashrc"})` → `allow`
  - `evaluate({tag:"edit", target:"@/etc/passwd"})` → `allow`
  - Host-side expansion for the last two is confirmed in source only. The host tool was not executed (UNVERIFIED end to end).
- Fix (minimal): before `resolveReal`, apply the host's normalization in the same order: strip one leading `@`, replace `^~(?=/|$)` with `os.homedir()`, and replace Unicode spaces `U+00A0`/`U+202F` with ` `. Use the same helper for `policy` and `modes`, or import it from `packages/policy/src/targets.ts` so pi-tools and pi-language-tools share it.
- Confidence: high on the policy result (probe). Medium on host behavior (source read, not executed).

### F2 — Headless policy drops every rule from a malformed or mistyped permissions file

- Severity: high (permission bypass)
- Lens: robustness/config
- Current: `packages/policy/src/extension.ts:22` and `:31` pass `onDiagnostic: () => {}`, so diagnostics never leave the process. `packages/core/src/config.ts:73` drops a rule whose tag fails `isTagName` (`"Edit"` is rejected). `:162` returns no rules when the file is unreadable. `parsePermissionsFile` returns `{rules:[],toolTags:{}}` on invalid JSON (config.ts, near line 101).
- Gap: a deny rule that does not parse is treated as if it were absent. The headless path cannot report it, so the user never learns the policy is not in force.
- Failure/impact: a child or an `edit`-mode session whose `permissions.json` contains a trailing comma, or a deny with `"tag": "Edit"`, writes `.env` without a prompt.
- Reproduction (verified; agentDir with a valid deny, then a corrupted variant, workspace `/tmp/v22/ws`, mode `edit`, target `.env`):
  - valid `{"rules":[{"effect":"deny","tag":"edit","pattern":".env"}]}` → rules 1 → `deny`
  - `{"rules":[{"effect":"deny","tag":"Edit","pattern":".env"}]}` → rules 0 → `allow`
  - `{"rules":[{"effect":"deny","tag":"edit","pattern":".env"},]}` → rules 0 → `allow`
- Fix (minimal): in headless mode, make a file that exists but does not load a block for every tool call with the diagnostic in `reason`, matching the existing fail-closed pattern at `extension.ts:58-64`. Alternatively, fail the whole load on any invalid entry. Do not keep silently partial rules.
- Confidence: high.

### F3 — Name-based shell allow rules let wrapper commands and `find -exec` run anything

- Severity: medium (permission bypass when the user has allowed the wrapper; no built-in mode allows shell)
- Lens: robustness/security
- Current: `packages/core/src/shell.ts:4-19` `DANGEROUS` lists `sh`, `bash`, `env`, `sudo`, `xargs`, and others but not `timeout`, `nohup`, `nice`, `command`, `exec`, `stdbuf`, `setsid`, `find`. `shellPartSafety` (`shell.ts:65`) checks only `basename(first token)`. `modes.ts:260-285` (`evaluateShell`) allows a part when a rule matches its prefix.
- Gap: an allow prefix is trusted for the whole segment. Its arguments are never inspected, and the wrapper's payload is not parsed.
- Failure/impact: with `allow shell find`, `find . -exec rm -rf {} \;` is allowed. With `allow shell timeout`, `timeout 5 rm -rf build` is allowed. The same applies to `nohup`, `command`, and `nice`.
- Reproduction (verified by probe, mode `edit`, shell fallback `ask`):
  - rule `allow shell find` → `evaluate({tag:"shell", target:"find . -exec rm -rf {} \\;"})` → `allow`
  - `checkShell` returns the same (`allow`)
  - rule `allow shell timeout` → `timeout 5 rm -rf build` → `allow`
  - rule `allow shell command` → `command rm -rf x` → `allow`
  - rule `allow shell nohup` → `nohup rm -rf x &` → `allow`
- Fix (minimal): add the wrapper names above to `DANGEROUS`. Deny `find` arguments `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, and `-fprint*` in `shellPartSafety`. Document in `packages/core/README.md` that shell allow prefixes trust the argument list.
- Confidence: high for the mechanism and the probe results. Medium on impact, since it depends on which names users allow.

### F4 — Prompt lock has no acquisition timeout or cancellation; a holder that never settles blocks every prompt

- Severity: medium (lockout)
- Lens: robustness
- Current: `packages/core/src/prompt-lock.ts:50-52` enqueues a waiter with no timeout and no abort signal. `:63-73` releases only in `finally` or `catch` of the operation promise.
- Gap: a waiter cannot leave the queue. If the holder's operation never settles, every later `withPromptLock` call waits forever. A waiter whose requester has gone away still runs its prompt when its turn arrives.
- Failure/impact: callers in pi-guard (`extensions/pi-guard/src/index.ts:139,206,290`), pi-question (`extensions/pi-question/src/index.ts`), pi-agent, pi-statusline, and the tui pickers all share this queue. One stuck approval freezes all of them in the process. Stale prompts also run after a session change.
- Reproduction (verified): hold a lock with a promise the test controls, enqueue a second call, and race it against 500 ms. Result: `still pending after 500ms`. After the holder resolves, the second call runs. Whether a real host `ctx.ui` dialog can stay unresolved is UNVERIFIED.
- Fix (minimal): accept an optional `{ signal, timeoutMs }`. On expiry or abort, remove the waiter from `state.queue` and reject. Callers that already expect an answer can pass the dialog's own timeout.
- Confidence: high on the mechanism. Medium on the production trigger.

### F5 — Nested-acquisition check fires for timers created inside a lock, after the lock is released

- Severity: medium (wrong behavior: a legitimate prompt throws)
- Lens: robustness
- Current: `packages/core/src/prompt-lock.ts:45-48` throws when `global.als.getStore() !== undefined`. AsyncLocalStorage propagates the store into every callback created inside `als.run`, including timers and listeners that outlive the operation.
- Gap: the check tests context ancestry, not whether the outer lock is still held.
- Failure/impact: an extension that schedules a prompt from a `setTimeout` or event listener set up during a prompt receives `prompt lock: nested acquisition is not allowed`, even when the outer lock is already free.
- Reproduction (verified): `await withPromptLock(async () => { setTimeout(() => withPromptLock(() => 1).catch(e => log(e.message)), 5); })` logs `prompt lock: nested acquisition is not allowed`.
- Fix (minimal): store the active token in `state` and set it to `undefined` in `release()`. Throw only when `state.activeToken === getStore()`.
- Confidence: high.

### F6 — Pricing falls back to silent zero cost for unknown ids and for cache tokens with no cache rate

- Severity: medium (wrong behavior: cost and budget under-reported)
- Lens: robustness, backend
- Current: `packages/core/src/pricing.ts:50-106` matches ids by `id.includes(key)` against a hard-coded table. Keys use dashes (`claude-3-5-sonnet`), so `anthropic/claude-3.5-sonnet` does not match and returns `undefined`. `pricing.ts:132-136` multiplies cache tokens only when both `usage.cacheRead` and `rates.cacheRead` are truthy. `o1` has no cache rate, so cache tokens cost 0.
- Gap: unknown and partially priced models produce `$0` with no "unpriced" signal. The budget cap in `usage.ts` (`setSessionBudgetCap`, `recordTurnUsage`) then never warns.
- Failure/impact: a session on an unlisted or dotted-id model reports `$0.00` and never hits `budgetWarning`.
- Reproduction (verified): `resolveModelPricing({id:"anthropic/claude-3.5-sonnet"})` → `undefined`. `calculateDollarCost({input:0,output:0,cacheRead:1e6}, {input:15,output:60})` → `0`.
- Fix (minimal): normalize `.` to `-` before matching. When no rate applies, return an explicit `unpriced` result and surface it, not a zero. For a missing cache rate, fall back to the input rate or document the zero.
- Confidence: high on the mechanism. The impact is UNVERIFIED for models where the host supplies `model.cost`, because `resolveModelPricing` reads that first (`pricing.ts:58-72`).

### F7 — Glob matching backtracks exponentially on patterns with several `*`

- Severity: medium (DoS of the permission check; event loop stall per tool call)
- Lens: performance, security
- Current: `packages/core/src/policy.ts:28-37` maps each `*` to `.*` and anchors the result. The same regex runs for every rule on every call: `policy.ts:111` (external) and `:176` (path).
- Gap: consecutive `.*` groups with a failing tail backtrack combinatorially. The target is model-controlled (web_search `query`, `web_fetch` URL, path arguments).
- Failure/impact: with 12 `*` segments, a 26-character target stalls about 290 ms and 30 characters about 720 ms. Each extra character multiplies the cost, so a long query blocks the Node event loop for each tool call.
- Reproduction (verified): `matchExternal([{effect:"allow",tag:"external",pattern:"*a"×12+"b"}], "a".repeat(30), "external")` → 719 ms. The 26-character case took 290 ms.
- Fix (minimal): collapse runs of `*` into one, then use an iterative wildcard matcher with two pointers and backtrack to the last `*` (O(n·m)). Or cap the target length before matching.
- Confidence: high.

### F8 — Shell split is quadratic on long whitespace runs

- Severity: low
- Lens: performance
- Current: `packages/core/src/shell.ts:44` `.split(/\s*(?:&&|\|\||[;|&\n])\s*/)`. Each start position scans the whitespace run and backtracks.
- Gap: the leading `\s*` and the separator alternation do not need whitespace to be part of the match.
- Failure/impact: time grows about 4× per doubling of spaces. Measured: 5k spaces 41 ms, 10k 165 ms, 20k 690 ms. Run once per `bash` tool call.
- Reproduction (verified): `splitShellParts(" ".repeat(20000) + "x")` → about 690 ms.
- Fix (minimal): split on `/&&|\|\||[;|&\n]/` and trim each piece. The regex then has no adjacent quantifiers.
- Confidence: high.

### F9 — Truncation and target display can split a surrogate pair

- Severity: low
- Lens: UI
- Current: `packages/core/src/format.ts:11` (`text.slice(0, HEAD_LENGTH)`, `text.slice(-TAIL_LENGTH)`) and `:16` (`target.slice(0, TARGET_LENGTH)`).
- Gap: slices count UTF-16 code units, so a cut between a high and low surrogate leaves a lone surrogate.
- Failure/impact: a tool result or permission prompt containing emoji near the cut shows replacement glyphs or fails strict UTF-8 encoding. The impact on the provider API is UNVERIFIED.
- Reproduction (verified): `truncateText("a".repeat(2999) + "😀" + "b".repeat(2000)).isWellFormed()` → `false`. `displayTarget("a".repeat(499) + "😀").isWellFormed()` → `false`.
- Fix (minimal): cut on code points (`Array.from(text)`) or step back one index if the cut lands on a high surrogate.
- Confidence: high.

### F10 — Session map keeps every owner forever

- Severity: low
- Lens: performance (unbounded growth)
- Current: `packages/core/src/registry.ts:22` `sessions: Map<unknown, SessionState>`. `state.ts:31,47,50` set entries. Removal happens only in `dropSession` (`state.ts:59`), which runs from `resetSession` and from `extensions/pi-guard/src/index.ts:459`.
- Gap: a `Map` holds strong references to owners. `sessions` is accessed only through `get`, `set`, and `delete` (grep of `packages/core/src`), so a `WeakMap` is a drop-in replacement.
- Failure/impact: each session switch or `setMode` on a new owner adds an entry that is never freed. A long-lived process with many sessions keeps all session managers alive.
- Reproduction (verified): 10,000 `setMode({}, "edit")` calls leave `getState().sessions.size === 10001`.
- Fix (minimal): `sessions: WeakMap<object, SessionState>`. Keep `ownerKey` guards for primitives as `usage.ts` does.
- Confidence: high on growth. Low on practical severity, since one process normally holds few sessions.

### F11 — `checkShell` has no production caller; it duplicates `modes.ts` `evaluateShell`

- Severity: low
- Lens: simplicity
- Current: `packages/core/src/shell.ts:102-` `checkShell`. Its only callers are in `packages/core/src/shell.test.ts` (grep). The runtime evaluator is `packages/core/src/modes.ts:260-285` `evaluateShell`, which reuses `splitShellParts`, `shellPartSafety`, and `matchShellPart` but repeats the decision logic. `packages/core/README.md:21` documents `checkShell`.
- Gap: two evaluators with the same rules. They already agree on the probes (`find -exec` → `allow` from both), so drift is latent, not active.
- Failure/impact: a future change to one evaluator will not reach the other. The deletion test passes: removing `checkShell` changes no runtime behavior.
- Reproduction: `rg -n -w checkShell extensions packages` lists only `shell.ts`, `shell.test.ts`, and the README.
- Fix (minimal): delete `checkShell`. Port its tests to `evaluate({tag:"shell"})` and update the README.
- Confidence: high.

### F12 — Built-in tool names are looked up on a plain object, so prototype keys act as tags

- Severity: low
- Lens: robustness
- Current: `packages/policy/src/extension.ts:42` `const tag = TOOL_TAGS[event.toolName] ?? tagsFor(ctx)[event.toolName];`. `TOOL_TAGS` (`packages/policy/src/targets.ts`) is a plain object literal.
- Gap: `TOOL_TAGS["constructor"]` and `TOOL_TAGS["toString"]` return functions. The "no permission category" branch at `extension.ts:43-49` is skipped, and the function is passed to `evaluate` as a tag.
- Failure/impact: the outcome is `ask`, so headless calls are still blocked. The reason text reads "needs approval" rather than "no permission category", and the path is not what the code intends. No allow is reachable (verified: `evaluate` returns `ask`).
- Reproduction (verified): `typeof TOOL_TAGS["constructor"]` → `"function"`; `evaluate({tag: TOOL_TAGS["constructor"], ...})` → `ask`.
- Fix (minimal): use `Object.hasOwn(TOOL_TAGS, name)` or a `Map`.
- Confidence: high.

### F13 — `cleanupWorkspace` deletes whatever path the caller marks as isolated

- Severity: low (latent)
- Lens: robustness
- Current: `packages/core/src/workspace.ts:46-54`: `if (!workspace.isolated) return;` then `rm(value, {recursive:true, force:true})` on `workspace.path`. It does not check that the path is under `.pi-workspaces`.
- Gap: the guard is a boolean, not a path check. Current callers (`extensions/pi-tasks/src/workspace.ts:58` and `extensions/pi-subagents/src/workspace.ts:58`) only pass objects from `allocateWorkspace` and keep them in memory, so the path is safe today.
- Failure/impact: if an isolated workspace object is ever rehydrated from disk or built from user input, `cleanupWorkspace` can recursively delete an arbitrary directory such as the project root.
- Reproduction: `cleanupWorkspace({path: "/some/project", isolated: true})` deletes `/some/project` (reasoned from code; not executed).
- Fix (minimal): verify `workspace.path` is `workspacePath(root, id)` for a known root, or refuse paths whose `basename(dirname(path)) !== ".pi-workspaces"`.
- Confidence: high on the code. Low on reachability.

## Failure modes

- **Symlink swap between check and use (TOCTOU).** `resolveReal` (`policy.ts:51-88`) resolves symlinks at check time. The host opens the file later. An agent that can create a symlink (for example via an allowed `ln`) can swap the target between the two steps. UNVERIFIED as exploitable with the host, because the host may also resolve symlinks.
- **Permission config is read-only in core.** Core writes nothing. `permissions.json` and `modes.json` are read here, and writes happen in pi-guard (`saveGuardConfig`, V05 resolved). Concurrent writers from several pi processes therefore reach this code only as partially written JSON. That path is F2.
- **Usage ledger.** Core does no file I/O. Usage persists as session custom entries through `persistUsage` (`usage.ts`), which writes a full cumulative snapshot each turn. Atomicity and multi-process concurrency belong to the host session store, outside this slice. `extractLatestUsage` over 20,000 entries with five subagents each took 41 ms (measured), so restore cost is acceptable at this scale.
- **mtime cache granularity.** `config.ts:190-191` keys on `mtimeMs` only. A rewrite that keeps the same mtime, for example `cp -p` or a restore from backup, returns stale rules until the next change. UNVERIFIED on the target filesystems.
- **Project overlay cannot loosen an agent deny.** Verified: agent `deny edit secret.txt` and project `allow edit secret.txt` → `deny`. Deny rules win across both files because `resolveMatches` applies deny-first (`policy.ts:156-180`).
- **Session switch.** `caches` is a `WeakMap` per owner (`registry.ts:23`), so session caches vanish with their owner. `dropSession` clears them explicitly on reset. No stale cache across switch was found.
- **Diagnostics channel is missing in headless mode.** See F2. Core returns diagnostics through a callback. The headless caller discards them and has no other output.

## Seams

- `core/shell.ts` `checkShell` and `core/modes.ts` `evaluateShell`: two evaluators for one policy (F11).
- `core/policy.ts` path resolution and host `resolveToCwd`: two normalizers for one argument (F1). The same gap exists in pi-tools (`extensions/pi-tools/src/index.ts:79`, `resolve(base, raw)`) and pi-language-tools (`extensions/pi-language-tools/src/tool.ts:705`, `resolve(effective, params.path)`). Those call sites pass `resolve` output to `checkPath`, so they inherit F1. Whether their reads touch `~` paths is UNVERIFIED.
- `policy/src/extension.ts` `onDiagnostic: () => {}` (lines 22 and 31): the headless seam drops errors that the interactive seam reports (F2).
- `core/prompt-lock.ts` `Symbol.for` global: deliberate, shares one queue across copies of core loaded by jiti. Good seam, no finding.
- `policy/src/targets.ts` duplicates the tool-category map (`TOOL_TAGS`) that pi-acp and pi-guard also consume. It is one module, so it is not a duplicate. The only risk is the plain-object lookup (F12).
- `checkPath` returns `ask` when no rule matches, and consumers test `!== "deny"` (`pi-tools/src/index.ts:50`, `pi-language-tools/src/tool.ts:221`, `pi-acp/src/extension/tools.ts:466`). Whether `ask` should count as allowed for listing is an open question below.

## Rejected defaults

- **Per-call glob compilation and no rule cache.** Measured: `evaluate` with 201 path rules took 574 µs per call; `evaluate` for shell took 6.8 µs; a cached `loadPermissions` (two `statSync` calls) took 16 µs. These are small against model latency. No optimization recommended.
- **Shell split ignores quotes.** Quoted `&&`, `;`, or `|` split the command. That over-approximates, so the result fails closed to `ask`. Unterminated quotes produce `ask` (probe: `echo 'x\nrm -rf /'` → `ask`).
- **Redirects and substitutions inside quotes are denied.** Over-approximation, fails closed.
- **Unmatched shell commands default to `ask`.** Matches the builtin layers.
- **Built-in tool tags cannot be overridden by `tools` config.** Documented in `extensions/pi-guard/README.md:68` and `packages/core/README.md:58`.
- **Nested prompt acquisition throws instead of queueing.** Intentional, avoids deadlock. F5 covers the false positive only.
- **`..` and absolute paths outside the root are denied.** Verified: `../../etc/passwd` and `/etc/passwd` → `deny`.
- **Path checks against the workspace root instead of the git root.** Intentional (`ctx.cwd`).
- **`formatDollarCost` without thousands separators.** Cosmetic.
- **Shell `allow` rules are not path-aware.** `allow shell cat` permits `cat /etc/shadow`, verified. This is how the shell tag is defined. Raised as an open question, not a bug.

## Open Questions

- Should headless children fail closed on any unreadable or invalid `permissions.json` (F2), or continue with defaults and report through the parent?
- Should `checkPath` returning `ask` count as readable for listing consumers (`pi-tools`, `pi-language-tools`, `pi-acp`)? They currently test only `!== "deny"`.
- Should shell allow prefixes be path-aware, or is name trust the intended contract (F3 and the `cat /etc/shadow` case)?
- What is the acceptable wait for a UI prompt in the prompt queue, and should the caller or the queue own the timeout (F4)?
- For unpriced models, should cost be reported as unknown rather than `$0.00` (F6)?

## Verdict

**fail.** Two high findings are permission bypasses that were reproduced: F1 (`~` and `@` prefixes escape the workspace boundary in `edit` mode, verified in policy and by host source) and F2 (a mistyped or malformed headless permissions file silently drops deny rules, verified). Medium findings F3 through F7 are real but depend on user allow rules, lock-holder behavior, or pricing data. F8 through F13 are low.
