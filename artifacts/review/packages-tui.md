# Review — packages/tui (V20)

## Scope

- Commit: a035b03 (branch main).
- Paths: `packages/tui/src/{frame,pager,picker,progress,viewer,index}.ts` and their `*.test.ts`. About 609 LOC of source.
- Consumers (rg, `extensions/`): `pi-agent` (roundedFrame in picker.ts:12, popup.ts:2), `pi-modal` (showCodeViewer), `pi-memory` and `pi-subagents` (showMarkdownPager), `pi-subagents` and `pi-tasks` (showFuzzyPicker, withCancellableProgress with an async operation).
- Host peers read: `@earendil-works/pi-tui` (`components/cancellable-loader.js`, `components/loader.js`, `components/select-list.js`, `components/markdown.js`, `tui.js` overlay layout and `hideOverlay`), `@earendil-works/pi-coding-agent` (`modes/interactive/interactive-mode.js` `showExtensionCustom`, `resetExtensionUI`).
- Prior review: `artifacts/review/ui-upgrades.md` (V17) is an idea inventory with no robustness findings, so nothing there is repeated.
- Baseline: `npm test` 1052/1052, typecheck and lint clean (reported by the parent task).
- Lenses: UI, robustness, backend I/O, performance, simplicity. All five applied.
- Probes: vitest files in `artifacts/scratch/` with a custom `ctx.ui.custom` mock. The probes were removed after running because this review may create only this file. Each reproduction below states the exact probe logic so it can be re-run.

## Findings

### F1 — Pending overlay holds the global prompt lock forever

- Severity: high (lockout).
- Lens: robustness.
- Current: `packages/tui/src/picker.ts:52`, `pager.ts:47`, `progress.ts:68` each call `withPromptLock(() => ctx.ui.custom(...))`. The promise only settles when the component calls `done`. The host `hideOverlay` pops the overlay without calling the factory's `done`: `node_modules/@earendil-works/pi-tui/dist/tui.js:499-512`. `resetExtensionUI` runs `this.ui.hideOverlay()` at `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1906`, and it is called from `beforeSessionInvalidate` (line 367) and from reload (line 5337). `showExtensionCustom` (line 2288-2340) resolves only through `close`/`done`.
- Gap: `showFuzzyPicker`, `showMarkdownPager` and `withCancellableProgress` have no timeout, no `ctx.signal` link (picker and pager have none), and no reaction to the overlay vanishing. The shared lock in `packages/core/src/prompt-lock.ts` is released only in `finally`, which never runs.
- Failure/impact: after one hidden overlay, every later call to any of the three helpers waits forever. Their `ctx.ui.custom` is never invoked, so the user sees nothing and gets no error until the process restarts.
- Reproduction (probe logic, vitest from `artifacts/scratch/`): `ctx.ui.custom = () => new Promise(() => {})`; call `showMarkdownPager(hang, …)`; then call `showMarkdownPager(next, …)` where `next.ui.custom` is a `vi.fn`. Observed output: `P6 second helper=pending-after-100ms customCalls=0`.
- Fix (minimal): link every helper to the overlay lifetime. Either pass `ctx.signal` into the picker and pager and call `done()` on abort, or have the helpers subscribe to the overlay handle (`options.onHandle`) and resolve when it is hidden. Then the `.finally` releases the lock.
- Confidence: high for the mechanism (host and probe verified). UNVERIFIED for reachability from a user action, since I did not drive `/reload` or a session switch with an overlay open.

### F2 — Picker footer and key hint clipped on short terminals

- Severity: medium (key hint hidden; list and selection still work).
- Lens: UI.
- Current: `packages/tui/src/picker.ts:107-124` renders title, filter, list (up to 8 rows plus a scroll row), a blank line, the preview (`preview()` at 89-103), a blank line and the hint `↑↓ move  Enter select  Esc cancel  type to filter` at 118-121. The overlay is `maxHeight: "75%"` (`picker.ts:148-154`). The host cuts the overlay from the bottom: `tui.js:1005-1006` `overlayLines = overlayLines.slice(0, maxHeight)`.
- Gap: the picker never checks the height it is given, and the hint sits at the end of the content.
- Failure/impact: at 20 rows (maxHeight 15), a 9-item list with the 5-line preview from `pi-tasks/src/index.ts:56-62` renders 19 lines. The footer is gone, so the user has no visible cue for Esc or Enter.
- Reproduction: mock `ctx.ui.custom` with `tui.terminal.rows = 20`, 9 items, each `preview: ["head","l1","l2","l3","l4"]`, call `render(60)`. Result: `P3c rows=20 rendered=19 hostMaxHeight=15 footerVisible=false`. The same probe with rows=40 keeps the footer.
- Fix (minimal): move the hint to the top (under the filter line), or drop the blank line and the preview when `maxHeight` is below about 20 rows. Use `tui.terminal.rows` as the viewer and pager already do.
- Confidence: high.

### F3 — Code viewer bottom border overflows the width it is given

- Severity: low (only when the overlay is narrower than about 33 columns, that is a terminal narrower than about 41 columns at the 80% overlay width).
- Lens: UI (frame consistency).
- Current: `packages/tui/src/viewer.ts:69-80`. The hint is built as ` ↑↓ scroll N/M · Esc close ` (about 30 columns) and is not truncated. `bottomFill` is clamped to 0 at `viewer.ts:73-76`. `safeWidth` is `Math.max(4, width)` at `viewer.ts:42`.
- Gap: the hint has no width check, unlike the header at `viewer.ts:48-52`.
- Failure/impact: the bottom line is wider than the overlay. The host clips it to the declared width (`tui.js:1035-1037`), so the `╯` corner and part of the hint disappear.
- Reproduction: `showCodeViewer` with 100 lines and `tui(50)`, then `render(w)` for w in {4, 20, 30, 33, 40}. Result: bottom widths were 32, 32, 32, 33, 40. Top widths matched w.
- Fix (minimal): `truncateToWidth(hint, safeWidth - 3, "")` before composing the bottom line, as `viewer.ts:82-86` already does for the header.
- Confidence: high.

### F4 — roundedFrame widens lines to 4 columns when width is below 4

- Severity: low.
- Lens: UI.
- Current: `packages/tui/src/frame.ts:11` `const safeWidth = Math.max(4, width);`. The same clamp is at `viewer.ts:42`.
- Gap: the function promises that output fits `width`, but for `width` 0 to 3 it returns 4-column lines.
- Failure/impact: a caller that passes a small width gets lines wider than its slot. The host clips them (`tui.js:1035-1037`), so the border breaks. Callers in `extensions/pi-agent/src/picker.ts:138` and `popup.ts:41` would need a width under 4 to hit this, so real exposure is unlikely.
- Reproduction: `roundedFrame(["x"], w, theme).map(visibleWidth)` for w = 0..3. Result: `4,4,4` for each w.
- Fix (minimal): return `[]` or truncate to `width` when `width < 4`. Or document the 4-column minimum in the JSDoc.
- Confidence: high.

### F5 — Progress loader timer leaks when the operation throws synchronously

- Severity: low (needs a non-async `operation`; both consumers pass async functions).
- Lens: robustness.
- Current: `packages/tui/src/progress.ts:92` creates the component, and the host `Loader` constructor starts `setInterval` (`node_modules/@earendil-works/pi-tui/dist/components/loader.js`, `setIndicator`→`start`→`restartAnimation`). `progress.ts:101` calls `operation(controller.signal)` outside any `try`. If it throws, the factory throws before it returns the component, so `dispose` never runs and `loader.stop()` is never called.
- Gap: the synchronous throw path does not run `finish`.
- Failure/impact: one orphaned 80 ms interval that calls `requestRender` on a closed TUI until the process exits.
- Reproduction: `ctx.ui.custom = (f) => new Promise((res, rej) => { try { f(tui, theme, {}, res) } catch (e) { rej(e) } })`, operation `() => { throw new Error("boom") }`. Spy on `setInterval` and `clearInterval`. Result: `P5 error=boom intervalsCreated=1 stillLive=1`.
- Fix (minimal): wrap the call in `Promise.resolve().then(() => operation(controller.signal))`, or `try { … } catch (e) { … }` that calls `finish` with the failure.
- Confidence: high.

### F6 — Pager keeps stale Markdown colors after invalidate

- Severity: low (applies only if the host invalidates a theme change while a pager is open; that host trigger is UNVERIFIED).
- Lens: UI (render cache).
- Current: `packages/tui/src/pager.ts:108-110` `invalidate(): void { cachedWidth = -1; }`. The `Markdown` instance (`pager.ts:50`) is never invalidated. Host `markdown.js:203-206` returns `cachedLines` whenever text and width match, and `invalidate()` at `markdown.js:198` is the only way to clear them.
- Gap: the pager's own cache is cleared, but the cache inside `Markdown` is not.
- Failure/impact: after a theme change, body and heading lines keep the old colors until the text or width changes.
- Reproduction: theme whose `fg` returns `[${tag}]${text}`; open pager with `# Head`, render, set tag to B, call `invalidate()`, render. Result: `P4b before="[A]Head…" after="[A]Head…"`.
- Fix (minimal): call `markdown.invalidate()` inside the pager's `invalidate`.
- Confidence: high for the cache mechanism. UNVERIFIED that the host calls `invalidate` on theme switch.

### F7 — Multi-character input is dropped in the picker filter

- Severity: low.
- Lens: UI (keys).
- Current: `packages/tui/src/picker.ts:34-40` `printableKey` returns `undefined` when `data.length !== 1` and not a Kitty printable. `picker.ts:137-144` then forwards the whole chunk to `list.handleInput`, which ignores unknown input.
- Gap: a chunk like `"abc"` is neither appended to the query nor split into characters.
- Failure/impact: text delivered in one chunk (for example a paste, if the host delivers one) disappears silently. How the host delivers pastes is UNVERIFIED.
- Reproduction: `picker.handleInput("abc")` then `render(60)[1]`. Result: `Filter: (type to search)` (unchanged).
- Fix (minimal): split a multi-character chunk into code points and call `printableKey` on each, or accept `data` when every code point is printable.
- Confidence: high for the picker behavior. Medium for real impact (depends on paste delivery).

### F8 — Code viewer does not close on Ctrl-C

- Severity: low (ergonomics; Esc, Enter and `q` close it).
- Lens: UI (keys).
- Current: `packages/tui/src/viewer.ts:84-89` close keys are `escape`, `enter`, `q`. The pager at `pager.ts:112-116` also closes on `Key.ctrl("c")`, and the picker closes on Ctrl-C through `tui.select.cancel`.
- Failure/impact: Ctrl-C does nothing in the viewer, which differs from the other two overlays.
- Reproduction: viewer `handleInput("\x03")`. Result: `closed=false`.
- Fix (minimal): add `matchesKey(data, Key.ctrl("c"))` to the close condition.
- Confidence: high.

### F9 — Progress starts the operation after the parent signal has already aborted

- Severity: low.
- Lens: robustness.
- Current: `packages/tui/src/progress.ts:93-99` calls `cancel()` when `parentSignal.aborted`, and `progress.ts:101` still calls `operation(controller.signal)`.
- Failure/impact: the operation is started after the caller has already cancelled. It gets an aborted signal, so a well-behaved operation returns at once, but any side effect before its first `await` still runs.
- Reproduction: `ac.abort()`, call `withCancellableProgress(ctx, "m", op, ac.signal)`, mock `custom` that calls the factory. Result: `P7b status=cancelled operationCalls=1`.
- Fix (minimal): return `{ status: "cancelled" }` before the `operation` call when `parentSignal?.aborted`.
- Confidence: high.

### F10 — Code viewer skips the prompt lock and repeats the pager's scroll code

- Severity: low.
- Lens: simplicity, robustness.
- Current: `packages/tui/src/viewer.ts:29` calls `ctx.ui.custom` directly. Picker, pager and progress all wrap it in `withPromptLock` (`picker.ts:52`, `pager.ts:47`, `progress.ts:68`). The viewer's `viewportHeight` (`viewer.ts:35-36`) and its key block (`viewer.ts:90-107`) duplicate `pager.ts:68-70` and `pager.ts:120-146` with a different page formula.
- Gap: a viewer can open while another locked overlay is open, and the two helpers size pages differently.
- Failure/impact: stacked overlays with focus not on the expected one (impact UNVERIFIED in host), and the same key set behaves with different page sizes.
- Reproduction: read-only comparison (`rg -n "withPromptLock|ctx.ui.custom" packages/tui/src`).
- Fix (minimal): wrap the viewer call in `withPromptLock`, or make the viewer a `plainText` mode of the pager so one scroll implementation remains.
- Confidence: high for the code difference. UNVERIFIED for user-visible impact.

### F11 — Progress keeps a second AbortController next to the host loader's signal

- Severity: low (simplicity).
- Lens: simplicity.
- Current: `packages/tui/src/progress.ts:71` creates `new AbortController()`. The host `CancellableLoader` already has `signal` and `aborted` (`node_modules/@earendil-works/pi-tui/dist/components/cancellable-loader.d.ts`). `progress.ts:33-39` also re-implements the Escape branch that the loader handles.
- Gap: two sources of truth for the same cancellation state. The loader's `signal` is never used.
- Failure/impact: none found. This is a maintenance burden only.
- Reproduction: `rg -n "loader.signal|new AbortController" packages/tui/src` returns only `progress.ts:71` and `progress.ts:63`.
- Fix (minimal): use `loader.signal` for the operation, or drop `CancellableLoader` and use `Loader`.
- Confidence: medium (the simplification is a judgment call).

## Failure modes

- **Overlay hidden by host without done** (F1): every helper waits forever, and the prompt lock is held.
- **Short terminal** (F2, F3): the picker loses its hint and the viewer loses its bottom border under about 20 rows or 41 columns.
- **Operation sync throw** (F5): one orphaned interval.
- **Pager before first render** (`pager.ts:57` `let width = 80`): a key handled before the first `render` clamps against 80 columns. The next `render` clamps again, so the state recovers. Not reproduced; minor.
- **Pager theme change** (F6): stale heading color.
- **Consumer operations** (`pi-tasks/src/task-tool.ts:398`, `pi-subagents/src/tool.ts:627`): both pass async functions and an outer `signal`, so the Escape and parent-signal paths resolve as `cancelled`. Verified by the existing `progress.test.ts:60` and `:78`.

## Seams

- `packages/tui` → host `@earendil-works/pi-tui`: `SelectList`, `Markdown`, `CancellableLoader`, `Loader`, `Text`, `fuzzyFilter`, `truncateToWidth`, `visibleWidth`, `matchesKey`, `Key`, `decodeKittyPrintable`. The package uses the host primitives directly. No host built-in is re-implemented except the frame (F4, F10, F11).
- `packages/tui` → `@hollowheap/core/prompt-lock`: `withPromptLock` throws on nested acquisition (`packages/core/src/prompt-lock.ts`). The consumer `operation` inside `withCancellableProgress` runs inside the lock context, so an `operation` that opens a picker or pager throws. No current consumer does that (checked: `pi-subagents/src/tool.ts:627`, `pi-tasks/src/task-tool.ts:398`).
- `frame.ts` (`roundedFrame`) → `pi-agent` picker and popup. Only seam with a second consumer. The viewer does not use it (F10).

## Rejected defaults

- Tabs: the host counts a tab as 3 columns (`node_modules/@earendil-works/pi-tui/dist/utils.js:229-230`, `:327`), so `visibleWidth("a\tb") === 5` and `roundedFrame` lines stay 20 columns. No overflow probe showed a mismatch.
- Picker per-keystroke cost: 6 keystrokes over 5000 items took 56 ms in total, about 9 ms each (`P8`). That is inside one frame and well above the expected list sizes (tasks and subagents). No cache added.
- Double resolution of a picker or progress promise: guarded by `settled` (`picker.ts:60-64` `finish`, `progress.ts:79-86`). Probe `P9`: Escape resolves `undefined` once.
- Escape and Ctrl-C in the picker: handled by the host `SelectList` through `tui.select.cancel` (`select-list.js` `handleInput`), so `onCancel` runs.
- Progress error after cancellation: intentionally swallowed (`progress.ts:103-108`), tested at `progress.test.ts:78`.
- Empty picker list: `SelectList` prints the no-match row and Enter does nothing (`select-list.js:handleInput`). Empty pager content renders `0-0/0`.
- Resize: pager and viewer read `tui.terminal.rows` and width at each render, and the pager cache is keyed by width. No stale-size path found.
- Host overlay width fallback and maxHeight: the host clips overlay lines to declared width and height (`tui.js:1005-1006`, `1035-1037`), so an overflow never crashes the TUI.

## Open Questions

1. Should overlays opened by these helpers survive `resetExtensionUI`, or should the helpers treat a hidden overlay as cancelled (F1)? Needs a decision on the expected contract with the host.
2. Does the host ever deliver a paste as one multi-character chunk to an overlay component? (F7 depends on it.)
3. Does the host call `invalidate()` on a theme switch for overlays that are open? (F6 depends on it.)

## Verdict

pass-with-findings

One high finding (F1) is a lockout whose mechanism is verified but whose reachability from a user action is UNVERIFIED. Fix F1 before relying on session reset or reload while a helper overlay is open. The rest are medium or low UI, robustness and simplicity items.
