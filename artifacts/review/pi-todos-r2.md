# Review — pi-todos re-review (V30)

## Scope

- Paths: `extensions/pi-todos/src/index.ts` (642 LOC), `src/todos.ts` (444 LOC), tests `src/index.test.ts`, `src/todos.test.ts` (39 tests, all pass at HEAD: `npx vitest run extensions/pi-todos/src`).
- Commit: a035b03. Recent slice commits: `git log -- extensions/pi-todos` shows only feature/render commits from `00b477c` through `35f168a`; no commit touched the slice after the V13 fixes were recorded.
- Lenses: robustness, UI, backend, performance, simplicity.
- Prior reviews: V13 `artifacts/review/pi-todos.md` (Verified Bugs table and Robustness Issues), V17 `artifacts/review/ui-upgrades.md` (pi-todos constraints only).
- Host reads: `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1853-1886` (widget set/cap), `.../core/extensions/runner.js:482-490,618-624` (stale ctx), `.../core/extensions/loader.js:427` (event-bus unsubscribe), `node_modules/@earendil-works/pi-tui/dist/tui-main-screen.js:459-487` (width guard).
- Probes: `/tmp/pi-todos-probe/probe.cjs` (jiti import of the slice with a mock `pi`/`ctx`). Deleted after the run. Each reproduction below states the call so it can be rerun.
- Shared packages: V20 (tui), V21 (runtime), V22 (core) not re-reviewed. Slice use of them: `@hollowheap/core/blocks` (`scanTaggedBlocks`, `parseMarkdownBlocks`) is the only core import; `@earendil-works/pi-tui` `truncateToWidth`, `visibleWidth`, `Text`, `matchesKey` are the only tui imports. The slice's `/todos` overlay awaits `ctx.ui.custom` (see F9), which is the V20 prompt-lock exposure.

## Prior resolutions

V13 (pi-todos.md):

- High, open todos hidden behind completed: holds. `todos.ts:255` renders `[...open, ...done].slice(0, WIDGET_LIMIT)`.
- Medium, todo processing gated on `ctx.hasUI`: holds. `index.ts:354-364` `message_end` has no UI gate.
- Medium, no `session_compact` handler: holds. `index.ts:348-352` appends state on compaction.
- Medium, `setupTerminalInput` accumulates listeners: holds. `index.ts:309-310` disposes the previous disposer; host returns a disposer (`types.d.ts:82`).
- Low, split divider used `│├`: holds. `todos.ts:395` emits `┼─`.
- Low, no dependency model: not implemented, and the V13 record says "All findings below were fixed". `todos.ts:6-11` has no `blockedBy`. Record drift, not a code regression.
- Low, priority not documented to the model: holds. `index.ts:23-41` (`TODOS_FORMAT`, last sentence) names `/todo priority`; `README.md:56-57` documents it.
- Low, duplicate IDs accepted by `readTodos`: holds. `index.ts:161,185` rejects duplicates.
- Robustness: `event.message` guard holds (`index.ts:354-362`); `contentText` non-array guard holds (`index.ts:51-62`); subagent/task payload validation holds (`index.ts:64-96,98-115`); `updateUI` checks `setWidget` (`index.ts:225`); `restore` try/catch (`index.ts:268-280`); split layout uses all todo sections (`todos.ts:345-346`); collapsed returns `undefined` (`todos.ts:227-228`, `index.ts:240-241`).
- Overengineering: `statusText` removed (no match in slice); widget overload removed (`todos.ts:225-230` takes `(todos, subagents, tasks, options)`).
- V17 constraint "every `render(width)` line must fit the width": NOT MET. See F1.

Regressed prior resolutions: 0 of 15 V13 resolutions. One V17 constraint is unmet (F1, which V13 never covered).

## Findings

### F1

- Severity: high (TUI crash)
- Lens: UI
- Current: `todos.ts:411-412` `const boxWidth = Math.max(opts?.width ?? 0, maxInner); const contentWidth = boxWidth - 4;`; `todos.ts:324` `maxInner` is sized from the longest item; `todos.ts:425` pads without truncating (`pad = " ".repeat(Math.max(0, contentWidth - itemW))`). The render closure passes `width: width >= 80 ? width : 0` (`index.ts:246-249`). Split layout (`todos.ts:331`) runs only when other sections exist, so a todos-only widget never truncates.
- Gap: the non-split path never truncates item text, and it grows the box to the widest item instead of the terminal width.
- Failure/impact: any todo longer than (terminal width − 4) makes the widget line wider than the terminal. `tui-main-screen.js:474-486` then calls `this.stop()` and throws "Rendered line N exceeds terminal width". The TUI exits.
- Reproduction: `formatTodoWidget([{id:1,text:"x".repeat(150),done:false}], [], [], {width:0})` returns lines with `visibleWidth` 158 (probe A: widths 40 and 80 both yield 158, 3 overlong lines). `{width:80}` with the same input yields 158 at non-split. CJK: `"中".repeat(60)` yields 128 columns at width 40 and 80. At width 200 the same text fits (200). Live path: a todo text over 76 columns in a 80-column terminal with no subagents or tasks.
- Fix: in the non-split branch, cap each item with `truncateToWidth(item, contentWidth - 1, "")` plus `…` (the split branch already does this at `todos.ts:347-351`), and set `boxWidth = opts.width ?? maxInner` without growing past it. Add a test with a 150-char todo at width 80 that asserts `visibleWidth(line) <= 80`.
- Confidence: high (probe output plus host guard read).

### F2

- Severity: medium
- Lens: UI, performance
- Current: `todos.ts:268-279` tasks and `todos.ts:281-315` subagents add one row per entry with no limit. Only todos are capped (`todos.ts:180,255,262-263`). `index.ts:246-250` returns a factory component, which bypasses the host's 10-line cap for string arrays (`interactive-mode.js:1871-1876` caps only `Array.isArray(content)`; the factory branch at `interactive-mode.js:1883-1885` has no cap).
- Gap: running tasks and subagents have no "+N more" count and no cap.
- Failure/impact: 300 active subagents produce a widget of 300+ rows above the prompt, pushing the prompt and output off screen. Each TUI frame re-renders all rows.
- Reproduction: `formatTodoWidget([], Array.from({length:300},(_, i)=>({id:`s${i}`,state:"running",startedAt:0})), [], {width:120, now:1000}).length` returns 302. Rows beyond the terminal height: UNVERIFIED (the host's overflow behavior for widgets was not read).
- Fix: cap subagent and task rows at a fixed count (for example 10) and append `+N more`, matching the todo cap.
- Confidence: high for row count; medium for the on-screen effect (UNVERIFIED).

### F3

- Severity: medium
- Lens: backend (unbounded context)
- Current: `index.ts:395-401` sends `content: formatTodoConfirmation(state.todos, …)` and `details: { todos: state.todos, … }` on every change. `todos.ts:53-87` (`parseTodoBlock`) accepts any count of items and any text length.
- Gap: no cap on item count, item length, or the confirmation size. Each confirmation repeats the full list.
- Failure/impact: a single 5000-item create block produces a 262,789-byte follow-up message. Every later change repeats the full list. Whether the follow-up message enters model context in full: UNVERIFIED (depends on host `convertToLlm` for custom messages).
- Reproduction: `formatTodoConfirmation(applyTodoCommand(empty, parseTodoBlock("create_todos", <5000 lines "N. task number N with some descriptive text">)).state.todos, [])` returns 262,789 bytes (probe D). A single item of 100,000 characters yields a 100,013-byte confirmation (probe L).
- Fix: cap item count per block and item text length (for example 500 characters, reject the block with an error result otherwise). Send only the changed todos plus open/done counts, and drop `details.todos` from the message.
- Confidence: high for bytes; medium for context impact (UNVERIFIED).

### F4

- Severity: low
- Lens: performance
- Current: `index.ts:389` `pi.appendEntry(TODOS_TYPE, state)` writes the full state on each change. `index.ts:271-276` restore calls `readState` on every branch entry with no early exit.
- Gap: snapshots are full copies, so the session grows as O(changes × todos). Restore walks all entries but uses only the last valid one.
- Failure/impact: measured with probe J, 100 single-todo creates append 100 entries totaling 510,526 bytes and 906,564 bytes of follow-up messages. Probe I: restore over 2000 entries of 200 todos takes 78 ms per `session_start` or `session_tree`. Expected load (tens of todos, tens of changes) costs under 1 ms, so this is low.
- Reproduction: probe I and probe J as described above (script deleted; the same loops are described here).
- Fix: iterate `getBranch()` backwards and stop at the first valid entry. Store deltas only if sessions grow past measured limits.
- Confidence: high (measured).

### F5

- Severity: medium
- Lens: simplicity (dead config) and UI
- Current: `index.ts:626-632` checks only `parts[0] !== "toggle"`; the target argument (`todos|dashboard|all`, shown in the description at `index.ts:623`) is never read.
- Gap: `/panel toggle dashboard` and `/panel toggle all` do not toggle the named panels; they toggle the todo panel.
- Failure/impact: a user who runs `/panel toggle dashboard` collapses the todo widget and gets "Panel collapsed".
- Reproduction: mock `pi` and `ctx`, call the `panel` command with `"toggle dashboard"`; notify text is "Panel collapsed" and `panelCollapsed` flips (probe G).
- Fix: accept only `todos` (or no target) and reject other targets with a usage message; or remove the target from the description.
- Confidence: high.

### F6

- Severity: medium
- Lens: robustness (recovery from corrupted state)
- Current: `index.ts:274-275` `const restored = readState(entry.data); if (restored) state = restored;`. `readState` rejects a whole entry if one todo is malformed (`index.ts:157-195`).
- Gap: a malformed newest entry is skipped without any notice, and restore falls back to an older snapshot.
- Failure/impact: the reverted list is what the next change persists, so todos created after the last good snapshot disappear for good on that branch.
- Reproduction: branch entries `[{todos:[{id:1,text:"a",done:false}],nextId:2}, {todos:[{id:1,…},{id:2,text:"b",done:"yes"}],nextId:3}]`; `session_start`, then `/todos` shows only `• 1 a` (probe F). Legitimate states from this code always pass `readState`, so the trigger is external corruption only.
- Fix: when the newest entry fails validation, notify the user with the entry index and the failed field. Keep the recovered older state, but make the discard visible.
- Confidence: high for the behavior; the corruption source is UNVERIFIED.

### F7

- Severity: medium
- Lens: backend (consistent error results to the model)
- Current: `todos.ts:53-87` `parseTodoBlock` returns `undefined` for any malformed block (continuation lines, checkboxes, empty items, non-numeric IDs). `index.ts:365-371` filters those out. `index.ts:395` is reached only when `commands.length > 0`, so a malformed block produces no feedback. `todos.ts:89-102` (delete branch): when open todos exist, `applyTodoCommand` returns `changed: false` with no reason.
- Gap: the model receives no error result for rejected blocks or refused deletes.
- Failure/impact: the model writes a `create_todos` block with a continuation line, believes the tasks exist, and proceeds. A `delete_todos` with open todos reports "Todos:" with no indication that nothing was deleted.
- Reproduction: `message_end` with `"```create_todos\n1. first\n   continued\n```"` adds zero follow-up messages and zero entries (probe K). `applyTodoCommand({todos:[{id:1,text:"a",done:false}],nextId:2},{type:"delete"})` returns `changed:false, unknownIds:[]` (probe E).
- Fix: when a closed block fails `parseTodoBlock`, or a delete is refused, send a follow-up with the tag, the reason ("open todos remain: 1"), and the unchanged list.
- Confidence: high.

### F8

- Severity: medium
- Lens: robustness (session switch)
- Current: `index.ts:218-219` `let subagents` and `let tasks` are set only by events. `index.ts:268-280` `restore` resets `state` but not `subagents` or `tasks`.
- Gap: running subagent and task rows from the previous session stay in the widget after `session_start` or `session_tree`.
- Failure/impact: after switching sessions, the widget shows subagents that belong to the old session until another `subagents:state` event arrives.
- Reproduction: `pi.events.emit("subagents:state",[{id:"s1",state:"running",startedAt:Date.now()-5000}])`, then `session_start` with `reason:"new"`. The widget still renders `@s1 00:05 ●` (probe H). Whether the subagent extension re-emits on session change: UNVERIFIED.
- Fix: clear `subagents` and `tasks` in `restore`, or key them by session ID.
- Confidence: high for this slice's behavior; medium for user impact (UNVERIFIED).

### F9

- Severity: medium
- Lens: UI (many items, key handling) and V20 exposure
- Current: `index.ts:419-436` `/todos` renders every todo as one `Text` with no scroll, no count, and no key for scrolling. `index.ts:420` `await ctx.ui.custom(...)` keeps the command handler pending until `done` runs, and `done` runs only on Esc, Enter, Ctrl+C, or `q`.
- Gap: a 150-item list is rendered as 150+ lines with no "showing X of N" count. If the host hides the overlay without calling `done`, the handler never resolves (the V20 prompt-lock hang).
- Failure/impact: items past the terminal height are unreachable. A hidden overlay leaves the command pending: V20 hang (host hide path UNVERIFIED in this review).
- Reproduction: `/todos` with 150 todos in TUI mode; the lines are emitted without truncation. Visible-row clipping: UNVERIFIED (host overlay sizing not read).
- Fix: render a bounded viewport with `showing a–b of N` and up/down handling. Do not `await` the overlay in the command handler (`void ctx.ui.custom(...)`).
- Confidence: medium (overlay clipping and hide path UNVERIFIED).

### F10

- Severity: low
- Lens: UI (key handling)
- Current: `index.ts:324-326` consumes every `\x18` (Ctrl+X) and starts a 1.5 s chord timer. `index.ts:318-321` returns `consume: false` for any key after the prefix, so the Ctrl+X is already swallowed.
- Gap: Ctrl+X is taken from the editor for 1.5 s on every press, even when the user does not continue the chord.
- Failure/impact: a Ctrl+X the user meant for the editor is lost, and the next key is not replayed.
- Reproduction: `onTerminalInput` handler receives `"\x18"` → returns `{consume:true}`; then `"a"` → `{consume:false}`. The `\x18` never reaches the editor.
- Fix: forward the prefix when the chord does not complete (replay `"\x18"` before `"a"`), or pick a prefix that the editor does not bind.
- Confidence: high (behavior); impact depends on editor bindings (UNVERIFIED).

### F11

- Severity: low
- Lens: UI (CJK/emoji)
- Current: `todos.ts:291-292` `normalizedTask.slice(0, 24)` counts UTF-16 code units.
- Gap: the cut can split a surrogate pair, and a 24-unit slice can be up to 48 columns of CJK.
- Failure/impact: a lone high surrogate reaches the terminal as a replacement character. Width is bounded later by the split truncation but not by the non-split path (see F1).
- Reproduction: `("a"+"😀".repeat(20)).slice(0,24)` ends with a lone high surrogate (checked with `node -e`; the same slice runs at `todos.ts:292`).
- Fix: slice by code point (`Array.from(text).slice(0,24).join("")`) or `truncateToWidth(text, 24, "…")`.
- Confidence: high.

### F12

- Severity: low
- Lens: UI (sanitization)
- Current: `index.ts:64-96` and `index.ts:98-115` validate types only; `todos.ts:266-275` (task `command`), `todos.ts:298-316` (subagent `id`, `activeTool`) concatenate raw strings.
- Gap: `id`, `command`, and `activeTool` are not normalized (`task` is normalized at `todos.ts:288-290`).
- Failure/impact: an id containing `\n` splits the row. Probe B renders `@x\ny 00:00 …` as one array element. Terminal impact beyond the broken row: UNVERIFIED.
- Reproduction: `formatTodoWidget([{id:1,text:"a",done:false}], [{id:"x\ny",state:"running",startedAt:0,task:"t"}], [], {width:120, now:0})`.
- Fix: normalize whitespace and strip control characters on every event-provided string before rendering.
- Confidence: high for the raw newline; low for the terminal effect.

### F13

- Severity: low
- Lens: simplicity
- Current: `index.ts:464-608` repeats the "mutate, `updateUI`, `appendEntry`, `notify`" block in six branches (complete ×2, edit, delete ×2, priority). `todos.ts:203-215` has two near-identical duration helpers (`formatDuration`, `formatToolDuration`). `todos.ts:231` `const opts = options;` followed by `opts?.` on a non-optional object (`todos.ts:238,331,339,411`). `TodoUpdate` (`todos.ts:26`) and `FormatTodoWidgetOptions` (`todos.ts:182`) are exported but not imported by any consumer.
- Gap: duplicate persistence seam; redundant alias; exports without consumers.
- Failure/impact: a future mutation that forgets `appendEntry` or `updateUI` is easy to introduce (the six copies already differ: `/todo complete all` calls `applyTodoCommand`, `/todo edit` does not check `changed`).
- Reproduction: grep `appendEntry(TODOS_TYPE, state)` in `index.ts` (six matches under the command handler).
- Fix: one `commit(next, ctx)` helper for mutations. Drop `opts` alias and unused exports. Merge the two duration helpers into one with a unit parameter.
- Confidence: high.

## Failure modes

- Long todo text in a todos-only widget: TUI exits with the width error (F1).
- Many running subagents or tasks: widget grows without bound (F2).
- Large create block: follow-up and details each repeat the full list on every change (F3).
- Corrupted newest snapshot: silent revert and loss of later todos on that branch (F6).
- Model writes malformed block or deletes with open todos: model is never told (F7).
- Session switch with subagents running: stale rows remain (F8).
- `/todos` with many items: no scroll, no count (F9).

## Seams

- Session entry `hollowheap.todos` (`index.ts:21`) and message type `hollowheap.todos.updated` (`index.ts:22`) are the persisted contract. Both are string constants, not exported.
- Event payloads `subagents:state` (`index.ts:254-259`) and `tasks:state` (`index.ts:261-266`) are consumed without a schema version.
- `formatTodoWidget` is exported (`todos.ts:225`) but only `index.ts` imports it. No other extension imports the slice (grep of `extensions/` and `packages/`).
- `TODOS_FORMAT` (`index.ts:23-41`) is injected into the system prompt every turn (`index.ts:293-295`); the size is fixed, so this is not a growth risk.

## Rejected defaults

- Host 10-line cap on string widgets (`interactive-mode.js:1927`): host default, applies only to array content. The factory path used here is not capped (F2).
- Stale `ctx` after session replacement: host drops event-bus subscriptions on invalidation (`loader.js:427`, `trackEventBusSubscription`). `lastCtx` is therefore not reachable from event handlers after a reload. No finding.
- Widget render cost: 100 renders of a 5000-todo widget took 46 ms in probe D (about 0.5 ms each). Not a finding.
- Tool concurrency: the slice has no tool; `message_end` runs synchronously on the single JS thread. No race.
- Chord timeout 1.5 s (`index.ts:326`): a timing choice, not a defect.

## Open Questions

1. Does a `sendMessage` custom message with `display: true` enter model context in full? Decides the severity of F3.
2. Does the host clip overlays taller than the terminal (F9), and does the overlay hide path call `done`?
3. Does the subagent extension clear or re-emit `subagents:state` on session change (F8)?
4. How often do `subagents:state` and `tasks:state` fire? Repeated `updateUI` calls replace the widget component each time (`index.ts:223-253`, `setWidget` at `index.ts:250`); measured churn is needed before any change.

## Verdict

fail. F1 crashes the TUI in a default path (any todo longer than the terminal width minus 4 in a todos-only widget). F6 and F7 lose state silently and give the model no feedback. Fix F1 first; it is a small, testable change.
