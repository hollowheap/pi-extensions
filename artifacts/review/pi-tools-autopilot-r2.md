# Review — pi-tools + pi-autopilot (V38, robustness re-review)

## Scope

- Packages: `extensions/pi-tools` (`src/index.ts` 105 LOC, `src/permissions.ts` 15 LOC), `extensions/pi-autopilot` (`src/index.ts` 25 LOC).
- HEAD commit range: `615d205` back to `f1053ec` for both paths. `a035b03` (codemode-only tools off model surface) touches pi-agent, pi-web, pi-language-tools, not these packages.
- Uncommitted pi-agent changes were ignored.
- Out of scope: V27 pi-statusline F7, V32 pi-agent F1/F4.
- Prior reviews: `artifacts/review/pi-tools.md` (V14), `artifacts/review/pi-autopilot.md` (V02), `artifacts/review/ui-upgrades.md` (V17).
- Context only: `artifacts/questions.md` "Brainstorm — pi-tools after search removal" (Q06 → D148) and "Brainstorm — fd/rg duplication".
- Method: source reads, `rg -n`, and out-of-tree probes in `/tmp/pi-tools-r2` (deleted after the run). Probes loaded the extensions through jiti with a mock `pi` and `ctx`.

## Prior resolutions

V14 (pi-tools):
- `fd.ts:38-57`, `rg.ts:19-27,65-68,90`: holds. Both files removed; no search tools remain in the package.
- `ExecDeps` and `RgMatch`/`parseRgLine` exports: holds. Removed.
- `index.ts:11-28` completeCd relative to `process.cwd()`: holds. Now `index.ts:28` uses `ctx.cwd`; the `process.cwd()` fallback at `:28` runs only without `ctx`.
- `index.ts:11-28` lists denied dirs: holds. `index.ts:42-52` filters with `checkPath`.
- `index.ts:79-83` fragile outside-root check: holds. `index.ts:19-25` `isWithinRoot` handles `isAbsolute` and `..` prefix.
- `config.ts:43-52` silent unreadable config: holds. `packages/core/src/config.ts:158-163` pushes `cannot read permissions file`.
- `index.ts:41-55` codemode auto-activation ("Required"): moved, not regressed in code. `a035b03` moved it to `pi-web/src/index.ts:17-30` and `pi-language-tools/src/index.ts:15-30`. D43 (`artifacts/decisions.md:286`) still says pi-tools activates codemode. See F12.

V02 (pi-autopilot):
- Duplicate `autopilot` keeps first layer: holds. `packages/core/src/modes.ts:92-99`; test `index.test.ts:27`.
- Cap optional: holds. README line 15; no mandatory cap in code.
- Exported `AUTOPILOT_MODE` mutable: holds (fixed). `index.ts:5` is `Object.freeze`, and `index.test.ts:22` checks it.
- Overengineering audit (single 16-line layer): holds.

V17 (ui-upgrades): no rows for pi-tools or pi-autopilot (`grep -c` = 0). Nothing to check.

Regressed prior resolutions: 0. One doc-drift item (D43) is listed as F12.

codemode check (a035b03): neither package registers a tool, so no tool is registered after `session_start` or after `/reload` from this slice. The `codemode` tool itself is not registered anywhere in this repo (`rg` finds only consumers and tests). Its provider is external and UNVERIFIED. See Open Questions Q3.

## Findings

F1 — high — Lens 1 (robustness) / Backend
- Current: `extensions/pi-tools/src/index.ts:66-104` (only `session_start` at `:63` and `registerCommand`; no `tool_call` handler). Consumers of the override: `extensions/pi-guard/src/index.ts:236-248` only.
- Gap: `/cd` sets state and status but changes no file tool unless pi-guard runs. The README "Try it" command is `pi -e ./extensions/pi-tools` (README.md:8-10), and README.md:14-17 says `/cd` changes the directory "for file tools".
- Failure/impact: standalone `/cd src` then `read x.ts` reads `./x.ts` at root. The footer shows `cwd src`. The file tools never see it.
- Reproduction: probe `handlers: ['session_start']`, `commands: ['cd']` after loading pi-tools alone; `/cd sub` sets `effectiveCwd` to `.../sub` but registers no rewrite. Test `index.test.ts:84-92` asserts only state and status, so it passes.
- Fix: state in README that `/cd` needs pi-guard for file tools, and rename the test. Do not add a second rewrite in pi-tools (duplicates pi-guard seam).
- Confidence: high (code path). Host `read` cwd behavior: UNVERIFIED, but no rewrite exists either way.

F2 — high — Lens 1 (autopilot)
- Current: `extensions/pi-autopilot/src/index.ts:12` `shell: "allow"`; `packages/core/src/shell.ts:4-19` DANGEROUS set (interpreters, `sudo`, `tee`, `dd`, `awk`; no `rm`, `git`, `find`, or `mkfs`); `shell.ts:65-68` only checks that set; `packages/core/src/modes.ts:260-273` `evaluateShell`.
- Gap: the "non-dangerous bash" in `index.ts:17` is decided by a narrow interpreter list. Destructive commands fall through to the layer default `allow`.
- Failure/impact: under autopilot, `bash` runs `rm -rf ~` or `git push --force` with no prompt. Under `ask`, the same commands prompt.
- Reproduction: `/tmp/pi-tools-r2/probe2.mjs`: `enterMode(owner,"autopilot")` then `evaluate({tag:"shell", target})`:
  - `rm -rf /` → autopilot `allow`, ask `ask`
  - `rm -rf ~` → `allow` / `ask`
  - `find / -delete` → `allow` / `ask`
  - `git push --force origin main` → `allow` / `ask`
  - `ls; rm -rf /` → `allow` / `ask`
  The autopilot test "allows everything but explicit denies" (`index.test.ts:43-75`) has no destructive-command case.
- Fix: add a destructive-command set to core shell safety (or an `ask` set), not a copy in autopilot. AGENTS.md forbids vendoring shell analysis in extensions. Add tests for these five commands.
- Confidence: high (probe output).

F3 — medium — Lens 1 (autopilot: budget and runaway)
- Current: `extensions/pi-usage/src/index.ts:205` `message_end` only accumulates and warns. The only abort is `index.ts:265-274` `before_agent_start` → `ctx.abort()`. Autopilot (`index.ts:12`) removes per-tool approval prompts.
- Gap: the cap is checked before the next run only. Nothing stops a run in progress, and autopilot has no turn cap.
- Failure/impact: with `/usage cap $0.50`, a single long autopilot run can exceed the cap by any amount before it stops.
- Reproduction: UNVERIFIED at runtime. Code-only: grep shows `ctx.abort` only at `index.ts:274`. Steps: `pi -e ./extensions/pi-guard -e ./extensions/pi-usage -e ./extensions/pi-autopilot`, `/usage cap $0.50`, `/mode autopilot`, prompt for a multi-step task, observe the total after the run.
- Fix: add a mid-run cap check in pi-usage `message_end` (out of this slice). Consider a turn cap in pi-guard for autopilot.
- Confidence: medium.

F4 — medium — Lens 1 (cwd consumers)
- Current: `extensions/pi-guard/src/index.ts:236` `if (tag !== "shell")` skips the rewrite. The rewrite at `:239-245` changes only `record.path`.
- Gap: `bash` (shell tag) and pathless `grep`/`find`/`ls` ignore `/cd`. Their default `"."` resolves to `ctx.cwd` (`index.ts:233`, `:249` `?? "."`).
- Failure/impact: after `/cd sub`, the footer shows `sub` but `bash` `pwd` and `ls` run at the project root. The README says `/cd` is for "file tools".
- Reproduction: `pi -e ./extensions/pi-guard -e ./extensions/pi-tools`, `/cd sub`, then `bash: pwd`. Expect root. Code-based; the host bash cwd is UNVERIFIED but the extension cannot change it (README.md:21-22 says Pi exposes no API).
- Fix: document the limit in pi-tools README; the status text could say "file tools" (see F8). A real fix needs a host cwd API.
- Confidence: medium.

F5 — low — Lens 4 (per-turn work)
- Current: `extensions/pi-tools/src/index.ts:43-52` runs `checkPath` (realpath walk per entry) for every directory before `sort`/`map`.
- Gap: permission filtering runs on all entries, not on the returned page.
- Failure/impact: completion latency grows with entry count.
- Reproduction: probe with 3000 subdirectories: `getArgumentCompletions("")` 298 ms, `("d1")` 97 ms (measured in `/tmp/pi-tools-r2`).
- Fix: compute the real root once and resolve each entry with `lstat`, or check `isDirectory` only for the first N. Low priority; only large dirs show it.
- Confidence: high for measurement; typical repos have fewer entries.

F6 — low — Lens 1 (deleted directory)
- Current: `packages/core/src/state.ts:53-55` `effectiveCwd` returns the stored path with no check. `index.ts:79-102` validates only when `/cd` runs.
- Gap: a directory deleted after `/cd` stays the effective cwd.
- Failure/impact: pi-guard rewrites every relative path into the missing directory, so calls fail with ENOENT until the user runs `/cd` again.
- Reproduction: probe E: `/cd gone`, `rmdir gone`, `effectiveCwd` returns `.../gone`. Code-based for the pi-guard failure.
- Fix: in `effectiveCwd` consumers, `statSync` the override and fall back to `ctx.cwd` with a notice.
- Confidence: high for the state result.

F7 — low — Lens 1 (persistence)
- Current: `packages/core/src/state.ts:42-51` `setCwd` never appends an entry. Mode persists via `state.ts:33-36` `appendCustomEntry`. `index.ts:63-65` `session_start` restores nothing for cwd.
- Gap: the mode survives resume/fork, the cwd does not.
- Failure/impact: after resume, the footer's `cwd` segment clears and file tools use root with no notice.
- Reproduction: UNVERIFIED for resume identity. Code shows no restore path.
- Fix: persist cwd as a custom entry and restore it in `session_start`, or document it as session-only.
- Confidence: medium.

F8 — low — Lens 3 (status text)
- Current: `extensions/pi-tools/src/index.ts:101` `setStatus("cwd", rel)`. Host footer `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/footer.js:253-260` joins all statuses sorted by key and truncates to width.
- Gap: `cwd` sorts before `tasks` (`pi-tasks` README:24 `setStatus("tasks", …)`). A long relative path pushes `tasks` off the line.
- Failure/impact: a running task count disappears when the cwd is long.
- Reproduction: `/cd` to a 90-character relative path in an 100-column terminal with one task running. UNVERIFIED if pi-statusline replaces the footer (`setFooter`).
- Fix: truncate the cwd value to a fixed width, or move it to a key that sorts last.
- Confidence: medium.

F9 — low — Lens 3 (notice text)
- Current: `index.ts:97` `directory denied by rules` for a symlink that escapes the root.
- Gap: `checkPath` (`packages/core/src/policy.ts:156-168`) denies a realpath outside the root. The message blames the rules.
- Failure/impact: the user looks for a rule that does not exist.
- Reproduction: probe B: root contains `link -> /tmp/<outside>`; `/cd link` → `error: pi-tools: directory denied by rules: link`. Containment holds (`edit` through the link is also denied: probe H).
- Fix: check `realpathSync` containment in the handler and emit `outside project root`.
- Confidence: high.

F10 — low — Lens 3 (notice repeat)
- Current: `packages/core/src/modes.ts:177-193` `enterMode` runs gates (`:185`, which emit the `onEnter` notice) before `setMode`; `state.ts:28-30` returns early when the mode is unchanged.
- Gap: entering `autopilot` while already in it repeats the warning notice.
- Failure/impact: a duplicate warning. Minor.
- Reproduction: probe H called `enterMode` once; a second call runs `runGates` again per the code. UNVERIFIED in the UI.
- Fix: skip gates when the mode is unchanged, or document.
- Confidence: medium.

F11 — low — Lens 5 (simplicity)
- Current: `extensions/pi-autopilot/package.json:16-20` lists `@earendil-works/pi-agent-core`, `pi-ai`, `pi-tui`, `typebox` as peers.
- Gap: `src/index.ts` imports only `@earendil-works/pi-coding-agent` (type) and `@hollowheap/core/*`.
- Failure/impact: unneeded peer installs and a wider compatibility surface.
- Reproduction: `rg -n "from \"" extensions/pi-autopilot/src` shows no import of those packages.
- Fix: delete the four peers.
- Confidence: high.

F12 — low — Lens 5 (doc drift)
- Current: `artifacts/decisions.md:286` D43 `[x]` requires pi-tools to activate codemode on every `session_start`. `artifacts/architecture.md:22` says pi-tools owns `/cd` only. `a035b03` moved the logic to pi-web and pi-language-tools.
- Gap: the decision was not marked superseded.
- Failure/impact: a future reader restores the removed behavior.
- Fix: mark D43 superseded by a035b03 (D73 covers only the codemode-default parts).
- Confidence: high.

## Failure modes

- Standalone pi-tools: `/cd` reports success while file tools ignore it (F1).
- Autopilot with destructive shell: runs silently (F2). This is the only path where a single command can cause irreversible loss in this slice.
- Autopilot with cap: the cap stops only the next run (F3).
- Mixed tools: pi-guard rewrites `path` but not shell or pathless calls (F4).
- Stale override: a deleted directory stays active (F6).

## Seams

- `pi-tools` → `core/state` (`setCwd`, `effectiveCwd`): one writer, consumers pi-guard, pi-statusline, pi-hooks, pi-dashboard, pi-tasks, pi-language-tools. The seam is a plain string with no validation at read time (F6).
- `pi-tools` → `core/policy` (`checkPath`): containment and deny live in core. Use it for every new path check.
- `pi-autopilot` → `core/modes` (`registerMode`, `ModeLayer.defaults`, `overrides`): the only seam. The shell fallback is the weak point (F2). `ModeLayer.overrides` (types.ts) can carry `ask` rules, but shell safety is core's job.
- `pi-guard` ↔ `pi-usage`: cap enforcement sits in pi-usage, not in the mode. Autopilot has no budget seam (F3).
- `pi-web` / `pi-language-tools` `session_start` (`pi-web/src/index.ts:17-30`): removes web tools before checking codemode. If codemode is not yet registered, web tools disappear from the model surface. UNVERIFIED (Q3).

## Rejected defaults

- Keep `isWithinRoot` in pi-tools (`index.ts:19-25`) even though `checkPath` also contains paths. It gives the distinct `outside project root` message used by tests (`index.test.ts:94-103`).
- Keep `permissions.ts` as a one-function adapter (V14 verdict). Two callers (`index.ts:42`, `:95`) and R10/D14 require delegation.
- Keep autopilot as its own package. D13 requires it, and the 25 LOC are the mode definition. The deletion test fails only because of D13.
- Do not add a `tool_call` rewrite to pi-tools (F1). It would duplicate pi-guard.
- Do not persist `/cd` as a mode-style entry without a decision (F7). It changes session file format.

## Open Questions

- Q1: Should `/cd` remain a standalone command (D148) if file tools only follow it under pi-guard? Deleting the package would not change pi-guard behavior.
- Q2: Does a destructive-shell list belong in core shell safety (F2) or in the autopilot `overrides`? AGENTS.md says shell analysis stays in core.
- Q3: Where does the `codemode` tool get registered, and does it register before `pi-web`'s `session_start` (`pi-web/src/index.ts:17`)? UNVERIFIED. This decides whether a035b03 holds at reload.
- Q4: Do untagged tools (not in `TOOL_TAGS`, `packages/policy/src/targets.ts:3-20`) still prompt under autopilot? `pi-guard/src/index.ts:232-235` says yes. Which tool names (e.g. the pi-question dialog) fall in that set is UNVERIFIED.
- Q5: If `loadPermissions` fails to read `permissions.json`, rules become `[]` (`core/src/config.ts:158-163`). Deny rules would then not block `/cd`. Severity for core is outside this slice.

## Verdict

Needs changes before autopilot is used with bash. F2 (high) lets `rm -rf ~` and `git push --force` run silently. F1 (high) is a documentation and test gap in the standalone `/cd` path. Prior resolutions hold (0 regressed). Other items are low.
