# Review — pi-statusline re-review (V27)

## Scope

- Paths: `extensions/pi-statusline/index.ts`, `src/{index,components,render,colors,config,settings,theme-picker,alerts}.ts`, `README.md`, `package.json`. About 1625 LOC including tests. Tests were checked only for baseline (1052/1052 per request), not audited line by line.
- Commit: `a035b03` per request. Newest commit touching the slice is `615d205` (`git log --oneline -10 -- extensions/pi-statusline`).
- Lenses: UI, robustness, backend, performance, simplicity.
- Prior reviews: `artifacts/review/pi-statusline.md` (V10, Resolution 2026-10-30 and 2026-11-04) and `artifacts/review/ui-upgrades.md` (V17, statusline items at lines 38, 55, 57, 121).
- Host reads: `node_modules/@earendil-works/pi-tui/dist/tui.js` (render scheduling, line 193 and 658-710), `pi-coding-agent/dist/modes/interactive/components/footer.js` (253-262), `interactive-mode.js` (2083-2090, 3520, 3572-3573), `theme/theme.js` (507-516, 549-575), `core/extensions/runner.js` (482-491, 630-635), `core/agent-session-runtime.js` (103-112).
- Probes: run out-of-tree in `/tmp/pi-sl-v27`, loaded through `jiti`, then deleted. Probe names below refer to those files.
- Shared packages (V20-V22) were not re-reviewed. Only slice usage of them is noted.

## Prior resolutions

V10 Resolution 2026-11-04:
- R1 `createGitDiffState.refresh` catches sync throws: holds. `components.ts:280-285` (`Promise.resolve().then(() => runner(cwd))`).
- R2 non-settling runner does not block refreshes: holds. No in-flight slot at `components.ts:278-286`.
- R3 `get` returns only the stored summary: holds. `components.ts:275-277`, read at `index.ts:191`.
- R4 `gitIntervalMs` and its settings row removed: code holds (`settings.ts:71-91` has two rows, no `gitIntervalMs` in `config.ts`). Regressed in docs: `README.md:129` still lists "git refresh interval" in the settings panel.
- R5 "`refresh` stores the latest result": not holding. `components.ts:270-272` only checks the generation, so two refreshes in the same generation can finish out of order and the older summary wins (F2).
- R6 generation counter invalidates late results after `clear`: holds. `components.ts:264, 270, 287-289`.
- R7 git refresh only on footer, branch, turn, and tool events: holds. `index.ts:155, 163, 245, 252`.

V10 Resolution 2026-10-30:
- P1 values received before footer install render after install: holds. Values stored at `index.ts:98-104`, read at `index.ts:194`, requested at `index.ts:164`.
- P2 provider values cleared on `session_start`: holds. `index.ts:206`.
- P3 footer disposal clears git cache and ignores late results: holds (generation, `components.ts:287-289`; cleanup at `index.ts:166-171`). The "abort inflight" wording no longer applies.
- P4 `model_select` ignores non-owning sessions: holds. `index.ts:257-258`.
- P5 sync throw clears slot, hard timeout: superseded. Throws handled at `components.ts:280-285`; process timeout is `execFile` `timeout: 5000` at `components.ts:244`.
- P6 `clear()` aborts and invalidates: holds as R6.
- P7 `clickActions` normalize and `/statusline click` runs them: holds. `config.ts:307-323`, `index.ts:280-390`.
- P8 default click actions `mode`, `model`, `usage`: holds. `index.ts:32-36`.
- P9 `cwd` segment resolves git root: holds. `components.ts:100-121`. Root refresh only at `turn_end` (`index.ts:243-255`), see F7.
- P10 `customComponentsPath` removed: holds (no occurrence in `src/`).
- P11 git cache is package-local: holds.
- V10 open items: `config.ts:388-392` now emits a diagnostic (`config.ts:389`), so the silence is fixed. `config.ts:325-345` ordering holds.

V17 statusline items:
- Every `render(width)` line fits the width: holds. Sweep at widths 1-200 for ASCII, CJK/emoji, and ANSI/OSC branch and model names produced 0 overflows and 0 throws (probe-render).
- Guard TUI-only behavior with `ctx.mode`: holds. `index.ts:149`, `index.ts:266` (theme), `index.ts:337` (settings).
- `SettingsList` for configuration: holds. `settings.ts:71-101`.
- `setFooter` for statusline surface: holds. `index.ts:151`.
- "pi-statusline uses HStack / width-aware composition" (`ui-upgrades.md:57`): not met. No `HStack` in the slice; width is handled by manual padding in `render.ts:52-67`. Recorded as a documentation claim gap, not a resolution.

Regressed prior resolutions: 2 (R4 docs at `README.md:129`; R5 latest-result claim at `components.ts:270-272`).

## Findings

F1 — severity high — Lens: Robustness, Backend
- Current: `config.ts:372` `if (!(item.type in BUILTINS) && ...)` and `render.ts:36-38` `const builtin = BUILTINS[spec.type]; ... builtin(spec, ctx)`.
- Gap: `in` and bracket lookup walk the prototype chain. `"__proto__"` is accepted as a builtin, and `BUILTINS.__proto__` is `Object.prototype`, which is not callable.
- Failure/impact: any user config with `{"type":"__proto__"}` makes every footer render throw `TypeError: builtin is not a function`. `renderStatusline` has no try/catch, and the TUI render runs in a `setTimeout` (`tui.js` scheduleRender). The host installs an `uncaughtException` handler that prints "exiting due to uncaughtException" and exits (`interactive-mode.js:3520, 3572-3573`). Result: pi exits when the first render throws after the config is loaded. `constructor` and `toString` are also accepted and render `[object Object]` or `[object Undefined]`.
- Reproduction: `/tmp/pi-sl-v27/probe-proto.ts`: `normalizeConfig({sections:{a:[{type:"__proto__"}]}})` reports `accepted: true, diag: 0`; `renderStatusline(40, ...)` throws `TypeError: builtin is not a function`. Same probe with `constructor` renders `"[object Object]"`.
- Fix: use own-property checks everywhere a type is looked up: `Object.hasOwn(BUILTINS, item.type)` in `config.ts:372` and `Object.hasOwn(BUILTINS, spec.type)` in `render.ts:36`. Better: build `BUILTINS` with `Object.create(null)` or a `Map`.
- Confidence: high for the throw and the acceptance. Medium for the exit path, which follows from the host handler at `interactive-mode.js:3520` (read, not executed).

F2 — severity medium — Lens: Robustness
- Current: `components.ts:278-286` (`refresh` starts a runner call with no sequence number), `components.ts:270-272` (`store` checks only the generation), `index.ts:155, 163, 245, 252` (every turn, tool end, branch change, and footer install calls `refresh`).
- Gap: results are written in completion order, not start order. Nothing stops an older `git status` from overwriting a newer one. The same gap exists in `refreshRepoRoot` (`index.ts:119-135`), which checks only session ownership. Also, every `refresh` spawns its own `git status`: 10 calls produced 10 runner calls (no coalescing).
- Failure/impact: a slow `git status` that started before a tool edit can land after the newer result, so the footer shows counts from before the edit until the next event. On large repos, a burst of tool calls spawns one `git status` each.
- Reproduction: `probe-misc.ts` section 1: call 1 (slow) reports 1 modified file, call 2 (fast) reports 3. Resolve call 2 first, then call 1. Final `get("/r").modified` is `1` (expected 3). Section 2: `refresh` ten times gives `runner calls for 10 refreshes: 10`.
- Fix: keep a per-cwd sequence number. In `store`, drop results whose sequence is not the latest started for that cwd. Coalesce: one in-flight run per cwd plus a dirty flag that triggers one more run when it finishes.
- Confidence: high (reproduced with controlled resolution order). Impact on a real large repo: UNVERIFIED (not timed on a large tracked tree).

F3 — severity medium — Lens: Backend (config data loss)
- Current: `config.ts:422-429` (`readConfigRoot` returns `{}` on any read or parse error), `config.ts:436-456` (`saveOptions` writes the whole root back), `config.ts:455` (`writeFileSync`), called from `index.ts:348`.
- Gap: a hand-edited `statusline.json` with a syntax error is treated as an empty object, so the next settings change overwrites the file. Sections and click actions disappear. The file is also written non-atomically.
- Failure/impact: `/statusline settings` with a single trailing comma in `statusline.json` removes all sections and click actions from disk. `loadConfig` warns about the bad JSON (`config.ts:414`), but `saveOptions` silently replaces the file.
- Reproduction: `probe-misc.ts` section 3. Input file had `sections` (`text` "keep") and `clickActions` plus a trailing comma. After `saveOptions(dir, defaultOptions())` the file contains only `options`.
- Fix: in `saveOptions`, if the existing file exists but does not parse to an object, do not write. Return an error so `index.ts:349-357` notifies the user. Optionally write to a temp file and rename.
- Confidence: high.

F4 — severity medium — Lens: UI (host consistency)
- Current: `index.ts:176-196` (render never reads extension statuses). Host footer renders them: `footer.js:253-262` (`footerData.getExtensionStatuses()`, sorted, joined, truncated).
- Gap: statuses set with `ctx.ui.setStatus` are dropped while this footer is installed. Repo producers: `extensions/pi-tasks/src/index.ts:30` (`setStatus("tasks", ...)`) and `extensions/pi-tools/src/index.ts:75, 101` (`setStatus("cwd", ...)`).
- Failure/impact: a running-task count or cwd status set by another extension never appears. README does not mention that statuses disappear; `README.md:11` only warns about other footer extensions.
- Reproduction: `probe-footer.ts` with footerData `getExtensionStatuses` returning `{tasks: "2 running"}`. Printed `statuses-visible-in-footer: false`.
- Fix: add a builtin segment (for example `extension_status`) that joins `footerData.getExtensionStatuses()` values, or append them as a second line like the host does. Document the choice.
- Confidence: high.

F5 — severity medium — Lens: UI (drop order)
- Current: `render.ts:52-67`. When the joined sections do not fit, `left` is truncated as one string to `room` and `right` is truncated when `room <= 0`. Nothing drops whole components.
- Gap: no priority. Truncation cuts by character position in the joined string, so a partial branch can survive while the whole cwd disappears.
- Failure/impact (default config, branch `feature/statusline-robustness`, cwd `/home/hollowheap/repos/my-pi-agent`, width 60): output `featur...` then tokens, cost, model, thinking, clock. The cwd and repo name are gone. At width 40 the whole left section is gone and the right section is cut mid-model-name (`claude-sonnet-4-5...`), dropping thinking and clock. The user cannot choose which component goes first.
- Reproduction: `probe-width.ts` (default config, the context above). Widths 40, 50, 60, 80, 100, 120 print the lines listed above. Width 50 keeps all right components and drops left entirely.
- Fix: when the line is too wide, drop whole components from lowest priority (defined by an explicit order or by section order), and truncate only the last surviving component. Keep the width-fit guarantee already verified.
- Confidence: high on observed output. Priority order is a design choice (see Open Questions).

F6 — severity medium — Lens: UI (theme)
- Current: `theme-picker.ts:26` (`const current = ctx.ui.theme;`), `theme-picker.ts:44-46` (`list.onCancel` calls `ctx.ui.setTheme(current)` with the object).
- Gap: `ctx.ui.theme` is the host Proxy (`theme.js:507`). `setTheme` takes a string or a `Theme` instance, and the Proxy is neither (`instanceof` is false). The call falls through to name lookup, which fails, and the host falls back to the system theme.
- Failure/impact: Escape in `/theme` switches to the system theme, not the previous one. README says Escape "restores the previous theme" (`README.md:135`).
- Reproduction: `/tmp/pi-sl-v27/theme-probe.mjs` (imports the host `theme.js` directly): `initTheme("dark")`, preview `light`, then `setTheme(current)` gives `Theme not found: [object Object]` and `after Esc: name = system`. Host path: `interactive-mode.js:2088-2090` routes non-`Theme` values to `setThemeName`.
- Fix: capture the name when the picker opens (`const originalName = ctx.ui.theme.name;`) and call `ctx.ui.setTheme(originalName)` on cancel.
- Confidence: high for the host module behavior. The interactive path was read, not driven in a TUI.

F7 — severity medium — Lens: UI (state mismatch)
- Current: `index.ts:121` and `index.ts:181` resolve the session cwd with `effectiveCwd` (pi-tools `/cwd` override). `index.ts:155, 163, 191, 245, 252` use `ctx.cwd` for `git status` and for the diff lookup.
- Gap: the cwd segment shows the overridden directory, and git_diff counts come from the original repo.
- Failure/impact: after `/cwd` to another repo, the footer shows `bigrepo/d` next to counts from `my-pi-agent`. Root is refreshed only on `turn_end` and `tool_execution_end` (`index.ts:243-255`).
- Reproduction: `probe-cwd.ts` with session cwd set by `setCwd(sessionManager, "/tmp/pi-sl-v27/bigrepo/d")` and `ctx.cwd` pointing at a repo with 2 untracked files. Footer: `"main /tmp/pi-sl-v27/bigrepo/d ?2"`.
- Fix: compute `const cwd = effectiveCwd(ctx.cwd, ctx.sessionManager)` once and use it for refresh, lookup, and root.
- Confidence: high.

F8 — severity medium — Lens: Performance
- Current: `components.ts:202-207` accepts any finite positive `intervalMs`. `components.ts:208` uses it. `index.ts:162` calls `setInterval(() => tui.requestRender(), clockMs)`.
- Gap: no lower bound. Each timer tick triggers a render, and each render runs `sumTokens` over the whole branch (`index.ts:38-70`, `index.ts:186`).
- Failure/impact: `intervalMs: 1` gives about 956 timer callbacks per second (measured). The host coalesces renders to one per 16 ms (`tui.js:193`), so the TUI still redraws about 60 times per second, each with a full-branch scan. Pegs CPU for a single config value.
- Reproduction: `probe-perf.ts`: `clockIntervalMs({z:[{type:"clock",intervalMs:1}]})` returns `1`; counting ticks over 1 s gives 956.
- Fix: clamp in `clockIntervalMs` (for example `Math.max(intervalMs, 1000)`) or reject below a floor in `normalizeConfig` with a diagnostic.
- Confidence: high for the timer rate. Host redraw rate from `tui.js:193` (read, not measured in a TUI).

F9 — severity low — Lens: Robustness (defense)
- Current: `index.ts:176-196` (render has no try/catch) reads `ctx.cwd`, `ctx.sessionManager`, `ctx.thinkingLevel`, `ctx.getContextUsage()`. Those throw after runtime invalidation (`runner.js:482-491, 630-635`).
- Gap: a throw in render reaches the host timer and the host exits (see F1).
- Failure/impact: the stale window looks narrow. `session_shutdown` calls `setFooter(undefined)` before invalidation (`agent-session-runtime.js:106-112`, `index.ts:227`). Reachability via `/reload` is UNVERIFIED.
- Reproduction: `probe-footer.ts`: after setting `stale = true`, `footer.render(80)` throws `Error: stale ctx`.
- Fix: wrap the body of `render` in try/catch that returns `[]` or the last good line.
- Confidence: high that the throw happens. Medium that it is reachable.

F10 — severity low — Lens: Backend (config)
- Current: `config.ts:388-392` replaces any sections object whose lists are all empty with the defaults and emits a diagnostic (`config.ts:389`).
- Gap: an explicit empty layout (`{"sections":{"a":[]}}`) cannot be expressed; it always becomes the default bar.
- Failure/impact: a user cannot hide the bar or create an intentionally empty section set.
- Reproduction: `normalizeConfig({sections:{a:[]}}).config.sections.a` is `[{type:"mode-guard"}]`; diagnostic `sections has no usable components; using defaults`.
- Fix: accept an empty array as valid. Keep the defaults fallback only when every entry was rejected.
- Confidence: high on behavior. Whether it is wanted is an Open Question.

F11 — severity low — Lens: UI (clock)
- Current: `components.ts:61-68` (`formatClock`).
- Gap: each token is replaced once with `String.replace` (first match only), so a second `HH` or `MM` is printed literally.
- Failure/impact: a custom format shows literal tokens.
- Reproduction: `formatClock(new Date("2026-01-02T03:04:05"), "HH:mm HH")` gives `03:04 HH`. `"YYYY-MM-DD MM"` gives `2026-01-02 MM`.
- Fix: one pass with `format.replace(/YYYY|MM|DD|HH|mm|ss/g, token => table[token])`.
- Confidence: high.

F12 — severity low — Lens: Backend (diagnostics)
- Current: `config.ts:402-407`. Any read error (`EISDIR`, `EACCES`) returns defaults with no diagnostic.
- Gap: only "file missing" should be silent.
- Failure/impact: an unreadable config silently produces the default bar, and the user sees no reason.
- Reproduction: `loadConfig(dir)` where `dir/statusline.json` is a directory returns `diagnostics: []`.
- Fix: treat `ENOENT` as silent and push a diagnostic for other errors.
- Confidence: high.

F13 — severity low — Lens: Backend (diagnostics)
- Current: `config.ts:372-375` reports every type not in `BUILTINS` and not in `extensions` as `ignoring unknown component type`.
- Gap: a known extension that is merely disabled is reported as unknown.
- Reproduction: `normalizeConfig({sections:{a:[{type:"usage"}]}, extensions:[]})` diagnostic `ignoring unknown component type "usage" in sections.a`.
- Fix: say "not enabled in extensions" when the name is an extension type the user already listed elsewhere, or report generally as "not enabled".
- Confidence: high.

F14 — severity low — Lens: Robustness (click actions)
- Current: `index.ts:375` `await pi.exec(command, actionArgs)` passes no `timeout`. `core/exec.d.ts:11` (ExecOptions `timeout`) makes `timeout` optional.
- Gap: a configured command that does not exit leaves the command handler pending.
- Failure/impact: `/statusline click model` never reports completion. The TUI itself is not blocked by this handler (not verified in a TUI).
- Reproduction: UNVERIFIED (code path read only). Set `clickActions.model` to `sleep 600` and run the command.
- Fix: pass a timeout (for example 30 s) and report it as an error.
- Confidence: medium.

F15 — severity low — Lens: Simplicity
- Current: `render.ts:9-14` (`applySeparator` exported, one caller, a one-line wrapper of `styleText`); `config.ts:396-420` (`loadConfig` returns `path`, no consumer); `components.ts` exports `ComponentFn`, `formatCount`, `formatClock`, `shortenPath`, `parseGitPorcelain` (only used in-module and in tests); `alerts.ts:7-12` (`process.env.VITEST` check and an injectable `AlertDelivery` seam in production code); `index.ts:93` (placeholder `createGitDiffState` replaced at each install); `components.ts:237-251` (`GitRunner` injection with one production adapter).
- Gap: exports and seams that exist only for tests or are never read.
- Failure/impact: maintenance cost; a test-environment check in production code.
- Reproduction: `grep -n "applySeparator\|path" ...` shows no consumer outside the defining file.
- Fix: drop the unused exports and `path`; inline `applySeparator`; move the VITEST switch to test setup; drop the placeholder by creating state lazily in the footer factory.
- Confidence: high for the greps. Low impact.

## Failure modes

- Width: every line fits at widths 1-200 for ASCII, CJK/emoji, and ANSI/OSC inputs (probe-render, 0 overflows). Overflow is not the problem. Dropping order is (F5).
- Theme: footer uses the live host Proxy (`theme.js:507`), so `/theme` changes repaint without reinstall. Holds. The picker restore is wrong (F6).
- Timers: clock interval and branch subscription are cleared in `cleanup` (`index.ts:166-171`), called from `dispose` and `disposeFooter`. `session_shutdown` also calls `setFooter(undefined)` (`index.ts:223-227`). Holds in code; not measured across `/reload`.
- Session switch: `values` cleared, `repoRoot` reset (`index.ts:148`), generation bumped by `clear` (`components.ts:287`). Late git results from the old session are dropped. Holds.
- Model switch: `model_select` ignores non-owner (`index.ts:257-258`). Model fallback reads `ctx.model` only when `currentModel` is missing. Holds.
- Compaction: no statusline event handler. Totals recompute on each frame from the branch (`index.ts:38-70`). Whether a frame occurs right after compaction is UNVERIFIED.
- Git hang: `execFile` kills the child after 5 s (`components.ts:244`). Grandchild processes are not killed (UNVERIFIED). `refreshRepoRoot` uses `pi.exec` without a timeout (`index.ts:123`), so a hung `git rev-parse` leaves `repoRoot` stale and does not block rendering.
- Background git locks: `git status` runs without `GIT_OPTIONAL_LOCKS=0` (`components.ts:241-249`). Impact on a concurrent user `git` command is UNVERIFIED.
- Reload: `pi.events.on` listeners (`index.ts:98`) are never removed. Whether `/reload` re-runs the factory and stacks listeners on a shared bus is UNVERIFIED. Duplicates are harmless today because `values` writes are equality-guarded (`index.ts:101-104`).
- Remote URLs and tokens: the slice never reads remote URLs. `git_branch` shows `footerData.getGitBranch()` only. No exposure found.

## Seams

- `statusline:values` and `statusline:request` (`index.ts:98-107, 164`): one-way, string-typed, shape-checked (`index.ts:99-103`). Adequate.
- Branch from host `footerData.getGitBranch()` (`index.ts:185`): correct reuse. The slice does not spawn its own branch probe.
- Repo root via `git rev-parse` (`index.ts:123`) duplicates host discovery (`findGitPaths` in `core/footer-data-provider.d.ts`). Whether an extension can reach `findGitPaths` through `ExtensionAPI` is UNVERIFIED.
- `createGitDiffState(runner, onUpdate)` (`components.ts:259`): the runner seam has one production adapter (`defaultGitRunner`). Test-only seam, kept.
- Extension status (`footerData.getExtensionStatuses`) is not consumed (F4). Missing seam.

## Rejected defaults

- 15 s clock interval when the format has no seconds (`components.ts:208`). A minute can display up to 15 s late. Host-style default; accepted.
- 5 s git timeout (`components.ts:244`). Reasonable for `git status`. Accepted.
- Per-render `sumTokens` over the whole branch: measured 0.74 ms per render with 20,000 branch entries (`probe-perf.ts`). Not material at that size. Revisit only if sessions reach about 100,000 entries (extrapolated, UNVERIFIED).
- `git status` cost on a repo with 20,000 untracked files in one directory: 0.007 s (collapsed to `?? d/`). Large tracked trees UNVERIFIED.
- Raw cwd, model, and branch text reach the terminal without sanitizing. The host footer does the same for `pwd` (`footer.js`, `truncateToWidth(theme.fg("dim", pwd), ...)`). Not specific to this slice. Git ref names cannot contain control characters, so branch is the least exposed.
- `mode` spinner advances only on host frames (`components.ts:90-98`). Acceptable while the agent is busy because the host redraws during streaming.

## Open Questions

- Priority order for dropping components (F5): explicit `priority` option, or section order?
- Should extension statuses (F4) be shown inside the bar, shown on a second line like the host, or documented as unsupported?
- Is an intentionally empty bar a supported state (F10)?
- Should git_diff and cwd follow the session cwd override (F7), or always the launch directory?

## Verdict

fail (one high, F1: a config value that makes every render throw, which the host turns into an exit). Without F1 the verdict would be pass-with-findings: 7 medium and 7 low findings, 2 regressed prior resolutions.
