# Robustness re-review — pi-dashboard (V34)

Prior: V04 (`artifacts/review/pi-dashboard.md`), V17 (`artifacts/review/ui-upgrades.md`, pi-dashboard items only).
HEAD: 615d205. `extensions/pi-dashboard` has no uncommitted changes. Tests were not run.

## Scope

- Source read in full: `src/index.ts` (250 LOC), `src/config.ts` (277), `src/settings.ts` (109), `src/render.ts` (24), `src/exec.ts` (10). Total 670 LOC. Test files (`*.test.ts`, 1,000+ LOC) were not reviewed line by line; only test names were read.
- Host and peers: `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js`, `dist/core/extensions/runner.js`, `dist/core/agent-session-runtime.js`, `node_modules/@earendil-works/pi-tui/dist/tui-main-screen.js`, `packages/runtime/src/exec.ts`.
- Recent commits touching the slice: `615d205` docs, `98f1994` release prep, `e68aa50` version bump, `ed74637` runtime rename. None changed behavior in the slice after V04.
- Probes: run with jiti from `/tmp/dash-probe`, now deleted. No repo file was changed.

## Prior resolutions

V04 "Resolution (2026-10-30)":

1. Stopped controllers ignore `start()`. Holds: `index.ts:125` (`if (stopped) return;`), `index.ts:131` (`stopped = true`).
2. Retry timers tracked and cleared on stop/success. **Regressed**: a second retry timer overwrites the first without clearing it, `index.ts:101-106`. See V34-F8.
3. Aborted or stopped successes do not overwrite state or render. Holds: `index.ts:84-86`, `index.ts:93-95`, `index.ts:113`.
4. Non-ENOENT `dashboard.json` read errors produce a diagnostic. Holds: `config.ts:208-214`.

V04 "Robustness Issues" that were not resolutions:

- `index.ts:114-119` stop never resets: fixed (see resolution 1).
- `index.ts:70-99` success path ignores abort: fixed (see resolution 3).
- `index.ts:71` hung `deps.run` freezes the section: still open. Dashboard-side evidence in Cross-slice impact (V21 F2).
- `config.ts:198-203` read failures silent: fixed (resolution 4).
- `index.ts:159-160` / `:189` fire-and-forget `stop()`: fixed. `stop()` is synchronous (`index.ts:130-137`), and the host disposes the old header before the new factory runs (`interactive-mode.js:1982-1985`).

V17 pi-dashboard items:

- Settings panel via `SettingsList` (V17 line 55): holds. `settings.ts:52-80`.
- Responsive layout primitives `HStack`/`Spacer` (V17 line 57): not adopted. `render.ts:3-18` still pads by hand. This is a suggestion, not a resolution, so no regression.
- Custom widget component (V17 line 58): not adopted. The dashboard uses `setHeader` (`index.ts:196`). Not a resolution, no regression.

Regressed: 1 (resolution 2). Holding: 3.

## Cross-slice impact

These are already reported elsewhere. Only the impact on this slice is stated.

- V21 F2 (timeout kills only the direct child): `exec.ts:9` sets `timeoutMs: 15_000`, which is the only bound on a command. If a command never settles, `running` stays true (`index.ts:78-79`) and `refresh()` returns early on every later tick. Probe: three refreshes against a never-settling `run` call `run` once. The section then shows stale output with no indicator until the header is replaced.
- V21 F3 (argv in error text): `index.ts:94` puts `error.message` verbatim into the always-visible header, and `index.ts:97` sends the first line to `notify`. Any argv in that text appears on screen.
- V20 (picker clipping at 20 rows): not affected. The `/dashboard` overlay has two rows (`settings.ts:36-53`).
- V30 F5 (`/panel toggle dashboard` toggles the todo panel): this slice has no toggle. The only command is `/dashboard` settings (`index.ts:218-244`), so a user cannot hide the header from inside Pi except by editing `dashboard.json`.

## Findings

Severity, lens, file:line, gap, impact, reproduction, fix, confidence.

### V34-F1 — high — Backend (data loss on settings save)

- Code: `src/config.ts:260-266`
  ```ts
  root.sections =
    settings.header === "none" ? terminals
      : [ settings.header === "version" ? { type: "version", gap: settings.gap }
          : { type: "header", gap: settings.gap }, ...terminals ];
  ```
- Gap: the header section is rebuilt from scratch and the custom `ascii` from the file is dropped.
- Impact: any change in `/dashboard` (`index.ts:227-236`) silently replaces custom banner art with the default logo.
- Reproduction: write `dashboard.json` with `{"sections":[{"type":"header","ascii":["CUSTOM ART"],"gap":0}]}`. Call `saveDashboardSettings(dir, {header:"banner", gap:1})`. The file now has `{"type":"header","gap":1}`, and `loadConfig` returns `DEFAULT_ART`. Confirmed by probe.
- Fix: keep the existing header section object and change only `gap`. Keep `ascii` when the preset is `banner`.
- Confidence: High (probed).

### V34-F2 — medium — UI (no row cap or overflow count)

- Code: `src/index.ts:116-123` (`lines` maps every row through `fitLines`). `src/render.ts:4-12` (no limit).
- Gap: a terminal section renders every output line. There is no row cap and no "+N more" line. `pi-todos` caps at `WIDGET_LIMIT = 10` and shows `+N more (/todos)` (`extensions/pi-todos/src/todos.ts:180`, `:255-263`).
- Impact: `exec.ts:25` allows about 1 MiB of stdout, so a command can return about 15,000 rows. Probe: 15,000 rows of 66 columns render in 19.8 ms per call, and all rows go to the TUI. The header then takes most of a short terminal. Whether the host clips a tall header is UNVERIFIED.
- Reproduction: `createDashboard({width:80,sections:[{type:"terminal",command:"big",args:[],intervalMs:30000,gap:0}]}, {run: async () => "row\n".repeat(15000), notify(){}})`, then `await refresh()` and `lines(80).length` returns 15000.
- Fix: add `maxLines` per terminal section (default about 10) and append `+N more`. Keep the cap in the section, not in `fitLines`.
- Confidence: High for the missing cap. UNVERIFIED for host paint behavior.

### V34-F3 — medium — Performance (interval floor and overflow)

- Code: `src/config.ts:116-125` (accepts any positive number). `src/index.ts:128` (`setInterval(..., intervalMs)`). `src/index.ts:113-114` (`requestRender` runs on every refresh, changed or not).
- Gap: no minimum interval. Values above 2,147,483,647 overflow the timer and Node sets them to 1 ms.
- Impact: one `dashboard.json` value spawns a process about every millisecond, and each refresh repaints the TUI. The `running` guard limits overlap but not rate.
- Reproduction: `intervalMs: 1` with a fake `run` returning `"same"` gives 287 runs and 287 renders in 300 ms. `intervalMs: 2147483648` gives `TimeoutOverflowWarning` and 284 runs in 300 ms. Probe-confirmed. The statusline clock uses a 1000 ms default for seconds (`extensions/pi-statusline/src/components.ts:203-210`).
- Fix: validate `intervalMs` to `[1000, 2147483647]` and report a diagnostic outside that range. Call `requestRender` only when the output changed.
- Confidence: High.

### V34-F4 — medium — UI (error state replaces last good output)

- Code: `src/index.ts:93-95` (`lines = [error.message]`). `src/index.ts:196` (`(tui, _theme)`: theme is unused).
- Gap: one failed poll erases the last good data. Error text has the same style as data. There is no stale or error marker.
- Impact: a transient failure looks like permanent output. The user cannot tell a failure from data.
- Reproduction: `run` returns `"good data"`, then throws `"x: exit 1"` on the next call. `lines(40)` after the second `refresh()` returns only `["x: exit 1"]`. Probe-confirmed.
- Fix: keep `lastGood` and show the error on its own line, styled with `theme.fg("error", ...)`, plus the last-good output below it.
- Confidence: High.

### V34-F5 — medium — Spec gap (manual refresh key)

- Code: `src/index.ts:196-205` (the header component has no `handleInput`). No key binding exists in `src/` (grep for `handleInput|key` returns nothing).
- Requirement: `artifacts/decisions.md:531` (D129) requires "key-triggered manual refresh". `artifacts/requirements.md:302` (R57) requires "interactive refresh".
- Gap: V04's Overengineering Audit marks the retry policy as "Required" for R57/D129 but does not check the manual-refresh clause.
- Impact: a user cannot force a poll. A stuck or stale section stays that way until the next interval.
- Fix: add `handleInput` that calls `controller.refresh()` on one key, or amend D129 and R57 with a decision.
- Confidence: High (absence verified by grep; requirement text read).

### V34-F6 — medium — Backend (documented `width` has no effect)

- Code: `src/index.ts:46` and `src/index.ts:119` (`renderWidth ?? width`). The host always passes a width (`render: (width) => controller.lines(width)`, `index.ts:199-201`). `src/config.ts:170-173` validates `width` in 10-500.
- Documentation: `extensions/pi-dashboard/README.md:3` ("one fixed character width"), `:34` ("fixed line width").
- Gap: `config.width` is read only when `lines()` is called with no argument. Production never does that.
- Impact: a validated, documented setting does nothing. Users see no diagnostic.
- Reproduction: `createDashboard({width:10,...})` with a `run` returning 16 characters, then `lines(40)[0].length` is 40. Probe-confirmed.
- Fix: either remove `width` from config and README, or clamp with `Math.min(renderWidth, config.width)`. See Open Questions.
- Confidence: High.

### V34-F7 — medium — Backend (corrupt file overwritten on save)

- Code: `src/config.ts:238-243` (`readRoot` returns `{}` on any parse error). `src/config.ts:269-275` (writes the new file over the old one). `src/index.ts:227-236` (the `/dashboard` path ignores `loadConfig` diagnostics; they are shown only at `session_start`, `index.ts:209-214`).
- Gap: a file that fails to parse is treated as empty and then replaced.
- Impact: user comments, unknown keys, and terminal sections are lost on a settings change. Probe: a file with a `//` comment and an unterminated object became `{"sections":[{"type":"header","gap":0}]}`.
- Reproduction: write invalid JSON to `dashboard.json`, call `saveDashboardSettings`, then read the file back.
- Fix: throw when the existing file exists but does not parse, and notify with its path. Do not write.
- Confidence: High (probed).

### V34-F8 — low — Robustness (retry timer leak; regresses V04 resolution 2)

- Code: `src/index.ts:101-106`. The new `setTimeout` at `:104` overwrites `retryTimer` without `clearTimeout` on the old one.
- Gap: an interval-triggered failure while a retry is pending creates a second timer. `stop()` (`index.ts:135-136`) clears only the last one.
- Impact: up to 8 s of pending timers after shutdown, which delays process exit. The timers do not spawn commands, because `index.ts:105-106` checks `stopped`.
- Reproduction: a failing `run`, `intervalMs: 100`, `refresh()`, wait 350 ms, `stop()`, then `process.getActiveResourcesInfo()` shows 2 `Timeout` handles. Probe-confirmed.
- Fix: call `clearTimeout(retryTimer)` before line 104.
- Confidence: High.

### V34-F9 — low — Simplicity (duplicate seam, unused parameter, dead exports)

- Code: `src/index.ts:26-31` and `:33-38` (identical `DashboardController` and `SectionController` interfaces). `src/index.ts:53` (`start: (_requestRender)`: unused parameter in `headerSection`).
- Dead exports: `src/config.ts:4` (`CONFIG_FILE_NAME`, used only inside `config.ts`). `src/config.ts:48` (`DEFAULT_INTERVAL_MS`, no importer). `loadConfig` returns `path` (`config.ts:199-230`) and `saveDashboardSettings` returns `path` (`config.ts:248`). No caller reads either (`index.ts:209`, `:227`, `:234`).
- Impact: maintenance cost only.
- Reproduction: `grep -rn "CONFIG_FILE_NAME\|DEFAULT_INTERVAL_MS\|\.path\b" extensions/pi-dashboard/src` shows no external use.
- Fix: make `SectionController` a type alias of `DashboardController` or drop it. Unexport the constants and drop the unused return values.
- Confidence: High.

### V34-F10 — low — Security hardening (control sequences pass through)

- Code: `src/index.ts:87` (`splitOutput(output)` stores raw stdout). `src/render.ts:3-18` (`fitLines` keeps escape sequences).
- Gap: no filtering of OSC or other control sequences before rendering.
- Impact: a configured command can write OSC 52 (clipboard) or title sequences on every refresh. The author of `dashboard.json` controls the command, so the exposure is limited. Terminal-specific effects are UNVERIFIED.
- Reproduction: `fitLines(["\x1b]52;c;ZXZpbA==\x07hi"], 40)[0]` still starts with `\u001b]52;c;`. Probe-confirmed.
- Fix: strip OSC and non-SGR CSI sequences in `splitOutput` before fitting.
- Confidence: High for passthrough. Impact UNVERIFIED.

## Failure modes

- Missing binary: `runCommand` rejects with `command not found: <name>` (`packages/runtime/src/exec.ts`). The error shows in the header. Retries run three times, then only the interval continues. Holds.
- Non-zero exit: `runBinary` throws with stderr text. The error shows in the header (V34-F4).
- Huge output: over 1 MiB, the runtime rejects with `stdout maxBuffer length exceeded`, and that text replaces the section (probe-confirmed). Output under the cap is rendered in full (V34-F2).
- Hung command: section freezes (Cross-slice, V21 F2).
- Refresh overlap: `running` guard (`index.ts:78-79`). Holds.
- Shutdown: `session_shutdown` calls `stop()` and `setHeader(undefined)` (`index.ts:245-249`). The host emits shutdown before invalidating the context (`agent-session-runtime.js:106-110`, `:297-301`). Holds.
- Session switch and `/reload`: the `ctx` captured in `install()` (`index.ts:184-190`) goes stale after replacement (`runner.js:482`). Holds for switches because `stop()` runs first. The `/reload` event order is UNVERIFIED.
- Stale output after refresh failure: see V34-F4.

## Seams

- `DashboardDeps` (`index.ts:17-22`) is the injection point for `run` and `notify`. It is used by tests and is adequate.
- `createDashboard` (`index.ts:141`) is the only public controller and is the test seam. Keep it.
- `runCommand` (`exec.ts:3-9`) is the only place that binds to the runtime. It also fixes the 15 s timeout, which is the only bound on a command.
- `settings.ts` depends only on config types. No cycle.
- The `render.ts` helpers are used by `index.ts` only.

## Rejected defaults

- Adding a grandchild kill inside the dashboard: belongs to `packages/runtime` (V21 F2).
- Memoizing `lines()`: no measured hot spot at realistic output sizes. 15,000 rows take 20 ms once per frame, which is above the threshold only at the 1 MiB cap.
- Removing retry and backoff (V34-F8 is about its bookkeeping, not its existence): D129 requires it (`decisions.md:531`).
- Moving to `setWidget` (V17 suggestion): the README places the dashboard at the header position on purpose (`README.md:3`).

## Open Questions

1. Should `width` be honored or removed? (V34-F6)
2. Is manual refresh required (D129, R57), or should the requirement change? (V34-F5)
3. Does the host clip a header taller than the terminal? UNVERIFIED. Affects V34-F2 severity.
4. Does `/reload` emit `session_shutdown` before invalidating the old `ctx`? UNVERIFIED. The reload path in `agent-session-runtime.js` was not read.
5. Test `index.test.ts:282` ("shows failures once and keeps the message") locks in the V34-F4 behavior. Test quality was not reviewed (UNVERIFIED).
6. Test `index.test.ts:305` ("starts one interval timer and stops it") may restate the implementation. Not reviewed (UNVERIFIED).

## Verdict

Needs changes before this slice is considered robust.

- Prior resolutions: 1 regressed (resolution 2, V34-F8). 3 hold.
- Findings: 1 high (V34-F1), 6 medium (V34-F2 to F7), 3 low (V34-F8 to F10).
- Top fixes: V34-F1 (preserve custom art on save), V34-F3 (interval floor and overflow), V34-F4 (keep last good output on error).
