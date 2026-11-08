# Review — pi-guard re-review (V29)

## Scope

- Paths: `extensions/pi-guard/src/{index.ts,rules.ts,config.ts,target-picker.ts,context.ts}` and tests. About 1166 LOC including tests. `extensions/pi-guard/src/index.ts` is 597 lines, `rules.ts` 203, `config.ts` 57, `target-picker.ts` 130.
- Commit: a035b03 (HEAD, clean). `git diff a035b03 -- extensions/pi-guard` is empty.
- Recent commits: `a57b263`, `2e31bdb`, `7654e54`, `53a88f6`, `f2fd670`.
- Lenses: 1 robustness/security, 2 UI, 3 backend, 4 performance, 5 simplicity.
- Prior reviews: V05 (`artifacts/review/pi-guard.md`), V17 (`artifacts/review/ui-upgrades.md`, no pi-guard-specific findings).
- Method: code reading with line citations. Behavior was checked by out-of-tree probes that drive the default export through a fake `pi` and `ctx` (`PI_CODING_AGENT_DIR` set to a `/tmp` directory). Probes were deleted after use. Existing suite: `npx vitest run extensions/pi-guard` passes, 5 files and 69 tests.
- Not checked live: the TUI rendering of the host dialogs at 40/80/200 columns and keyboard focus. Those items are marked UNVERIFIED.

## Prior resolutions

V05 Resolution lines (all 7 hold at a035b03; regressed count 0):

- `tool_result` ignores non-array content: holds. `index.ts:428`.
- `/context` treats a non-array `getBranch()` as empty: holds. `index.ts:584`.
- `isSubpath` takes a base root; trusted roots resolve against the workspace: holds. `rules.ts:55-58` and `rules.ts:126` (`isSubpath(root, canonicalTarget, workspaceRoot)`).
- Cached subpath decisions choose the most specific path, stricter on ties: holds for one map only. The tie branch (`rules.ts:85-90`) can only fire for identical canonical keys, so it is unreachable. The session and persistent maps are never compared against each other (see F2).
- `tool_call` fails closed on unexpected errors: holds. `index.ts:416-425`.
- `saveGuardConfig` writes a temp file and renames it: holds. `config.ts:55-56`. No fsync and no temp cleanup on failure. Both are host-default level concerns (see Rejected defaults).
- Session state lives in a per-extension runtime object: holds. `index.ts:52` (`GuardRuntime`), `index.ts:212` (instance).

V17 (`ui-upgrades.md:101`): the convention "guard TUI-only behavior with `ctx.mode === "tui"` or `ctx.hasUI`" holds. `index.ts:193` gates the custom picker on `ctx.mode === "tui"`, and `index.ts:205-206` gates on `ctx.hasUI` and `ctx.ui.select`.

## Cross-slice impact (V22 F1-F5)

- F1 (`~` and `@` not expanded): pi-guard is affected and does not mitigate. The guard resolves `~/x` as `<ws>/~/x`. Probe: in edit mode, `write {path:"~/pg-probe-never-written"}` returns undefined (allowed, no prompt). `rules.ts:20-52` produces `/…/ws/~/pg-probe-never-written`. The host expands `~` and strips `@` (`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js:35-44`). So a write that the host sends to `$HOME` is judged as in-workspace by the guard. This is a permission bypass in pi-guard's own `edit` gate.
- F2 (headless malformed `permissions.json` drops deny rules): affected. Interactive mode is partly mitigated: `index.ts:97-99` forwards the diagnostic to `ctx.ui.notify`. The rules are still dropped. Headless has no notice path. Not re-run. pi-guard's own `guard.json` has the same silent-drop problem (F6).
- F3 (allow-prefix shell rules trust arguments): affected, not mitigated. `index.ts:399` calls core `evaluate`, which routes `shell` to `evaluateShell` (`packages/core/src/modes.ts`). The guard does not add argument checks. Not re-run.
- F4 (prompt lock has no timeout): affected. pi-guard takes the lock at `index.ts:139`, `index.ts:206`, `index.ts:290`, and `target-picker.ts:45`. None of these has a timeout or abort signal. A stuck dialog blocks all later prompts.
- F5 (nested acquisition throws for timer-scheduled prompts): not triggered. pi-guard has no `setTimeout` or `setInterval` (grep of `src/`), and no prompt runs inside another lock.
- Also from V22: `TOOL_TAGS` is a plain object. `index.ts:231` reads `TOOL_TAGS[event.toolName]` without an own-property check. A tool named `constructor` gets a function as its tag. Probe: the call falls through to `evaluate`'s `?? "ask"` default and is prompted (`{"block":true,"reason":"pi-guard: constructor a.txt was not approved"}`). It fails closed here, so it is not a finding.

## Findings

### F1 — high — Permission bypass — trusted root overrides a persisted deny

- Current: `rules.ts:125-131` returns trusted before any decision is read: `for (const root of trustedRoots) if (isSubpath(root, canonicalTarget, workspaceRoot)) return {isTrusted: true}`. Decision lookup starts at `rules.ts:136`. `persistDecision` at `rules.ts:187-196` only removes the exact root on deny. A child deny never removes the ancestor root. `index.ts:267-270` then returns `undefined` (allow).
- Gap: a deny on a descendant is ignored whenever an ancestor was allowed indefinitely. The trusted-root loop has no specificity or deny check.
- Failure: a file the user explicitly denied is read without a prompt after the user later approves its parent directory.
- Reproduction (probe S1): (1) `read` `<ext>/secret.txt`, select "Deny indefinitely". (2) `read` `<ext>`, select "Allow indefinitely". (3) `read` `<ext>/secret.txt` returns undefined with 0 prompts. `guard.json` holds `decisions: {secret.txt: deny, ext: allow}` and `trustedRoots: [ext]`.
- Fix: run one most-specific lookup over trusted roots (as allow), persistent decisions, and session decisions. Let the most specific entry win, and let deny win on equal depth. Delete the separate trusted-root early return.
- Confidence: high (probe).

### F2 — high — Permission bypass — session allow on an ancestor beats a persistent deny on a subdirectory

- Current: `rules.ts:136-152` checks exact session, exact persistent, most-specific session, then most-specific persistent. Each most-specific lookup runs on its own map. A deeper persistent deny is never compared with a shallower session allow.
- Gap: specificity is compared only within one scope.
- Failure: a directory the user denied indefinitely becomes readable after the user allows a shallower ancestor for the session.
- Reproduction (probe S2): (1) `read` `<ext>/sub`, select "Deny indefinitely". (2) `read` `<ext>`, select "Allow (this session)". (3) `read` `<ext>/sub/file.txt` returns undefined with 0 prompts.
- Fix: same as F1. Compare all entries in one list by path depth.
- Confidence: high (probe).

### F3 — high — Consent integrity — approval dialog hides the command tail and shows raw control characters

- Current: `format.ts:6` sets `TARGET_LENGTH = 500`. `format.ts:14-18` (`displayTarget`) cuts at 500 characters and adds `…`. It does not escape control characters. `index.ts:140` (`confirm(... displayTarget(target))`), `index.ts:292` (out-of-workspace title), and the `requestApproval` path show the result.
- Gap: the user approves a command whose text after character 500 is not shown. Escape sequences and newlines reach the host dialog unchanged.
- Failure: a shell command such as `echo <600 chars>; <payload>` shows only the benign prefix. Any `\x1b[...` in a command can rewrite or hide dialog lines on a terminal.
- Reproduction (probe S9): `bash {command: "echo " + "a"×600 + " ; touch hidden-marker"}` shows a confirm whose body does not contain `hidden-marker`. `bash {command: "echo ok\n\x1b[2K\x1b[1Gsafe: approve\x1b[0m"}` passes the raw ESC and LF bytes into the dialog body (`JSON.stringify` of the body shows `\u001b[2K`).
- Fix: escape C0/C1 controls (`\n` as `⏎`, ESC as `\e`) before display. Show the head and the tail, and state the total length. Put the full text in a scrollable view or refuse to prompt above a cap.
- Confidence: high for the byte path (probe). UNVERIFIED for how the host renders ESC in `ctx.ui.confirm`.

### F4 — high — Permission bypass — allow scope ignores tag

- Current: `index.ts:267-273` returns `undefined` for any tag when the target is trusted. Only the `plan` + `edit` case is blocked. `rules.ts:187-189` stores an indefinite allow as a trusted root for the path, with no tag.
- Gap: an approval given for `read` or `search` (or for a web URL) also permits `edit` outside the workspace in `ask` mode, where `edit` defaults to `ask` (`packages/core/src/modes.ts`, `BUILTIN_LAYERS` ask.edit).
- Failure: after the user approves a directory for reading, a `write` into it runs with no prompt and no recorded consent for writing.
- Reproduction (probe S5): `read {path: <ext>}` select "Allow indefinitely". Then `write {path: <ext>/new.txt}` in `ask` mode returns undefined with 0 prompts.
- Fix: record the tag with the decision (`read`/`search` vs `edit`), and require a matching tag. Or prompt once per tag class.
- Confidence: high (probe).

### F5 — medium — Mode race — approval granted under one mode runs under another

- Current: `index.ts:399` evaluates the mode at call time. `index.ts:412` awaits `requestApproval` (`index.ts:128-146`) and returns `undefined` after approval. The mode is not checked again.
- Gap: a mode change during the prompt does not revoke the pending approval.
- Failure: a write approved in `ask` runs after the session switched to `plan`, where `edit` is denied (`modes.ts` plan overrides `*` → deny).
- Reproduction (probe S6): `write {path: <ws>/a.txt}` in `ask`. In the confirm handler, run the `/mode plan` command, then return true. The result is undefined (allowed).
- Trigger in the TUI: UNVERIFIED (a modal dialog may block `/mode`). It is realistic for RPC or ACP clients that send mode changes concurrently.
- Fix: after `await requestApproval`, re-run `evaluate` (or compare the mode with the mode at decision time) before returning `undefined`.
- Confidence: high for the handler sequence. Medium for the live trigger.

### F6 — medium — Data loss — malformed `guard.json` is read as empty and then overwritten

- Current: `config.ts:15-16` (missing), `config.ts:21-22` (non-object), `config.ts:39-40` (parse error) all return an empty config silently. `index.ts:256` loads it without `onDiagnostic`. `rules.ts:183` reads it again inside `persistDecision`, and `rules.ts:198` writes the new config over it.
- Gap: no diagnostic, and the write replaces unreadable content.
- Failure: a truncated file with `trustedRoots` and other decisions is replaced by only the newest decision. Earlier allows are dropped, so later calls prompt again, and nothing tells the user why.
- Reproduction (probe S3): write `{"trustedRoots":["/keep/me"],"decisions":{` to `guard.json`, then select "Deny indefinitely" on an outside path. The file becomes `{"trustedRoots": [], "decisions": {<new>: "deny"}}`. Notices: none.
- Fix: on parse failure, notify with the file path, move the file to `guard.json.bad-<ts>` before rewriting, and refuse persistent writes until the file is valid.
- Confidence: high (probe).

### F7 — medium — Wrong behavior — `/grant` overrides plan mode and deny rules, and matches any tool

- Current: `index.ts:390-396` returns `undefined` for an active grant before `evaluate` (`index.ts:399`). The grant matches by target string only, not by tag (`index.ts:548-553`).
- Gap: a grant is a full bypass. It is not limited to the tag the user meant.
- Failure: in `plan` mode, `/grant <file> 1h` allows `write` to that file. A grant on a shell command string also skips `permissions.json` deny rules.
- Reproduction (probe g): `/mode plan`, `write a.txt` is denied, `/grant a.txt 1h`, `write a.txt` returns undefined.
- Fix: check deny rules and plan-mode `deny` before consulting grants. Or scope grants by tag and document the override in the README if it is intended.
- Confidence: high (probe). Whether the override is intended is an Open Question.

### F8 — medium — Dead config — `/grant` on an out-of-workspace path always prints "Granted" and never applies

- Current: the out-of-workspace branch (`index.ts:266-358`) returns in every path (allow, deny, ask, or block). The grant check at `index.ts:390` is never reached for those targets. `index.ts:556` still prints `Granted <target> for <duration>`.
- Gap: the grant is stored and reported, but the path check ignores it.
- Failure: the user is prompted (or blocked) again after a grant that reported success.
- Reproduction (probe S4): `/grant <abs ext/secret.txt> 5m`, then `read` the same file with the select returning undefined. The result is a block with one select prompt. The notice still reads "Granted".
- Fix: consult active grants before the out-of-workspace branch, or reject `/grant` for targets that are outside the workspace and not trusted.
- Confidence: high (probe).

### F9 — medium — Unsafe default — Enter approves "Allow (this session)" for an outside path

- Current: `index.ts:294` lists "Allow (this session)" as the first option. The host selector starts at index 0 (`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/extension-selector.js:12`), and Enter selects the highlighted row (`extension-selector.js:75-77`). Esc calls `onCancel`, which returns `undefined` and blocks (`index.ts:303-308`).
- Gap: the most permissive, persistent-for-session option is the default. Deny is the default only after moving the cursor.
- Failure: a reflexive Enter gives session-wide access to an outside path, including a path such as `~/.ssh`.
- Reproduction: source reading. Live key test UNVERIFIED.
- Fix: put "Deny (this session)" first, or "Ask" first, and keep Allow options below.
- Confidence: medium (host source confirmed; live TUI not run).

### F10 — medium — Secret exposure — URL targets are judged as file paths and persisted with query strings

- Current: `targets.ts` `readToolTarget` returns the URL for `web_fetch`, and `index.ts:231-258` runs the same path check for every non-shell tag. `rules.ts:20-52` resolves the URL as a path. `persistDecision` (`rules.ts:198`) writes the resolved string, which contains the query.
- Gap: a URL is not a filesystem path. Its query text is written to `guard.json`.
- Failure: a `web_fetch` URL with `../` segments that resolve outside the workspace produces a prompt. "Allow indefinitely" stores the URL, including `?token=…`, as a trusted root and decision key. `guard.json` is mode 0600 (`config.ts:55`), so the exposure is local.
- Reproduction (probe w): `web_fetch {url: "https://example.test/" + "../"×30 + "x?token=SECRET"}`, select "Allow indefinitely". `guard.json` contains `"/…/x?token=SECRET"` as both a trusted root and a decision. A plain URL (no `..`) resolves inside the workspace and is not persisted.
- Fix: skip the path check for non-path tags (`web_fetch`, `web_search`, `decide`), and evaluate them with `evaluate`. Persist only real filesystem paths.
- Confidence: high (probe).

### F11 — low — Ergonomics — "Ask (this session)" shows two dialogs on each later call

- Current: `index.ts:350-358` stores `ask` and then calls `requestApproval`. On the next call, `rules.ts:136-139` returns `ask`, which is not `deny`, so `index.ts:283-300` shows the five-option select again, then the confirm.
- Reproduction (probe S10): the second call's prompt kinds are `["select", "confirm"]`.
- Fix: when the cached decision is `ask`, call `requestApproval` directly.
- Confidence: high (probe).

### F12 — low — False positive — names beginning with `..` count as outside the workspace

- Current: `rules.ts:66` uses `rel.startsWith("..")`.
- Reproduction (probe S11): `read {path: "..cache"}` in the workspace prompts "Allow access to out-of-workspace path ..cache?".
- Fix: test `rel === ".."` or `rel.startsWith("../")`.
- Confidence: high (probe). Fail-closed, so low severity.

### F13 — low — Dead and drifting options

- `rules.ts:85-90`: tie branch unreachable (see Prior resolutions).
- `rules.ts:174-176`: runtime scope check unreachable from typed callers.
- `index.ts:80` `GRANT_DURATIONS` includes `30s`, which completion offers (`index.ts:506`). The picker at `index.ts:205-207` offers only `5m`, `15m`, `1h`.
- Fix: delete the unreachable branch and the runtime check. Use one duration list.
- Confidence: high (code).

### F14 — low — Duplicate store — an indefinite allow is written twice

- Current: `rules.ts:187-196` writes `decisions[path] = allow` and also pushes the path into `trustedRoots`. `checkPathTrust` reads both, in a different order (see F1).
- Gap: one decision lives in two places with different precedence rules. This is the structural cause of F1.
- Fix: store allow only in `decisions`. Keep `trustedRoots` for config-file entries only. Then F1 needs one lookup, not two.
- Confidence: high (code).

## Failure modes

- Parallel tool calls: every prompt goes through the lock (`index.ts:139`, `:290`), so prompts do not overlap. The decision is computed before the lock is taken. Two queued calls for the same outside path show two prompts, even after the first was answered with "Allow (this session)". Low impact. Code reading only.
- Abort during a prompt: `ctx.ui.confirm` and `ctx.ui.select` take no abort signal. A tool call that the model abandons keeps its prompt open and holds the lock, which blocks every later prompt (V22 F4). Not re-run.
- Non-UI modes: `requestApproval` (`index.ts:133-137`) and the out-of-workspace branch (`index.ts:283-287`) block when `hasUI` is false. Probe S7 confirms: bash and unknown tools return "needs approval (no UI)". Outside reads return "is denied". Fail closed.
- Unknown and late-registered tools: the `tool_call` hook is global (`index.ts:416`), so tools registered after startup are gated. Unknown tools are prompted on each call (`index.ts:231-234`), with no "remember" option. Fail closed.
- Nested tool calls (codemode, subagents): the host documents that `tool_call` fires for nested calls (`dist/core/extensions/types.d.ts:273`). UNVERIFIED in a live run.
- User `!` and `!!` commands: the host emits `user_bash` (`types.d.ts:899`). No extension in `extensions/*/src` or `packages/*/src` subscribes to it, so these commands are not gated. See Open Questions.
- Expired grants: `index.ts:553` appends to `sessionGrants` and nothing prunes it. Only user `/grant` calls add entries, so growth is bounded by user actions. Low.
- Config read per call: `index.ts:256` reads `guard.json` on every non-shell tool call, and `loadContextPermissions` re-reads permissions on each `evaluate`. Probe S14: about 1.5 ms per in-workspace read with 1000 persisted decisions, and about 200 calls take 0.3 s. A session makes tens to hundreds of calls, so this cost is small.
- Diagnostics dedup: probe S13 shows one `pi-guard` notice for three tool calls with a malformed `permissions.json`. The mtime cache de-duplicates. Holds.

## Seams

- `packages/policy/src/extension.ts:79` is a second `tool_call` gate with its own `TOOL_TAGS`, `readToolTarget`, and `evaluate` use (`:22-40`). Its loaders pass `onDiagnostic: () => {}` (`:22`, `:31`), while pi-guard notifies (`index.ts:97-107`). The two gates disagree on outside paths: policy denies them (`evaluatePath` `hard.outside`), while pi-guard prompts. If both are loaded, the order and result are not defined by this slice. UNVERIFIED which pairing is used in which mode.
- `packages/core/src/config.ts` owns `permissions.json` and `modes.json` loading with diagnostics. `guard.json` loading lives only in `extensions/pi-guard/src/config.ts` and has no diagnostics (F6). The two config readers use different error contracts.
- `persistDecision` (`rules.ts:167`) is the only writer of `guard.json`. Its read-modify-write runs with no `await` between the read and the write, so two calls in one process cannot interleave. Cross-process lost updates remain possible but the window is sub-millisecond.
- `index.ts:231` (`TOOL_TAGS` plain-object lookup) is the same pattern as V22 F12. It fails closed here (see Cross-slice).

## Rejected defaults

- No cache for `guard.json` or permissions: 1.5 ms per call at 1000 decisions does not justify invalidation logic. Rejected under the no-unmeasured-optimization rule.
- TOCTOU between the guard's `realpath` check and the host's open: the check and use are separate calls. Exploiting it needs write access to the workspace or a trusted root, which is already a stronger attacker. Host-level concern.
- `saveGuardConfig` without fsync or temp cleanup: a crash can lose the newest decision but cannot corrupt the file, because the rename is atomic (`config.ts:55-56`). Host default.
- Symlink canonicalization: `rules.ts:20-52` resolves existing and non-existing paths through the nearest existing ancestor. This is the intended behavior.
- Passthrough `task`/`subagent` actions (`targets.ts` `PASSTHROUGH_ACTIONS`): intentional. Their child calls are gated when they run tools.
- `ask` mode allows `read`, `search`, `external` by default: the core mode defaults (`packages/core/src/modes.ts`), not pi-guard behavior.
- Plan mode allows edits to `artifacts/plan.md` and `artifacts/specs.md` (`modes.ts` plan overrides): intended.

## Open Questions

1. Should `/grant` override plan mode and deny rules (F7), and should grants be tag-scoped?
2. Should user `!`/`!!` commands (`user_bash`) be gated in `ask` mode? No extension subscribes today.
3. Should a trusted-root allow apply to write tags at all (F4), or should write access always prompt?
4. Should a mode change during a pending approval revoke the approval (F5), or should the prompt be non-interruptible?
5. Is "Allow (this session)" as the first, default-selected option intended (F9)?

## Verdict

**fail.** Four high findings are reproduced at a035b03: F1 and F2 (a deny is overridden by an allow on an ancestor, across the trusted-root and session/persistent scopes), F4 (a read approval grants write), and F3 (the approval dialog hides command text past 500 characters and passes raw control characters). Probe S1 and S5 show the bypasses with 0 prompts. The V05 resolutions still hold.
