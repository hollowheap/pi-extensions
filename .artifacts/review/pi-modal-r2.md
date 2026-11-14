# Review — pi-modal re-review (V28)

## Scope

- Paths: `extensions/pi-modal/src/editor.ts` (784 LOC), `keymap.ts` (202), `index.ts` (133), `vimkeys.ts` (89), `working.ts` (69). Tests read: `index.test.ts`, `vimkeys.test.ts`, `working.test.ts`.
- Commit: `a035b03` (HEAD). Recent slice commits: `07ce2ba`, `3f75b03`, `858c894` (codemode/fallback labels), `a0187ac` (vim-aware editor, original feature).
- Host read: `node_modules/@earendil-works/pi-tui` 1.4.0 (`components/editor.js`, `editor.d.ts`, `keybindings.js`, `keys.d.ts`, `terminal.js`), `pi-coding-agent` 1.4.0 (`custom-editor.js`, `interactive-mode.js` 2206-2262 and 1898-1914, `utils/clipboard.js`).
- Prior reviews: `artifacts/review/pi-modal.md` (V08, Resolution 2026-10-30) and `artifacts/review/ui-upgrades.md` (V17). V17 has no pi-modal findings or Resolution lines; its only pi-modal mention is the `setEditorComponent` usage bullet.
- Lenses: UI (primary), robustness, backend (config), performance, simplicity.
- Method: probes ran from `/tmp/pi-modal-probe` (harness loads `editor.ts` through jiti, feeds key sequences to `ModalEditor.handleInput`, asserts `getText`, `getCursor`, `getMode`, and `render(width)` output). Probes were deleted after the run. Repo files were not edited.
- Baseline (`npm test` 1052/1052, typecheck, lint) is taken from the request and was not re-run here.
- Shared packages: only the way this slice uses `packages/tui` and `packages/core` is reviewed (F3, F7, F12).

## Prior resolutions

V08 Resolution (2026-10-30), one line each:

1. BASH badge while prompt starts with `!`: holds (`editor.ts:536`, `editor.ts:574`).
2. Visual highlight after prompt decoration; column-zero selection includes prompt marker: regressed. Highlight runs at `editor.ts:655` before gutter prepend at `editor.ts:667-673`, so `❯` is never inside the reverse-video run. Probe: `abc`, `0`, `v`, `l` gives a reverse-video run of `ab`, with `❯` outside it. The test at `index.test.ts:331-339` has a comment saying the prompt is included, but its assertion expects the highlight to start at `hello`. Resolution text and test disagree.
3. Selection deletion repositions through public input, not host-private `state`/`preferredVisualCol`: holds (`editor.ts:170-190` uses `setText`; `editor.ts:204-220` uses `handleInput`). Emoji defect is F1.
4. `/` search moves to match; `n`/`N` wraparound: regressed. Wraparound holds (`editor.ts:222-260`). Movement does not land on the match when the buffer has wrapped lines or non-BMP text: `editor.ts:204-220` (F6).
5. `:%s/old/new/g` substitutes and preserves cursor: holds for the `/g` form (probe `hello` → `heLLo`, cursor restored). The non-`g` form diverges (F14), which the resolution does not claim.
6. Selection scroll derived from visible content height, not host `scrollOffset`: holds as code (`editor.ts:637`; no `as unknown` left). Behavior is wrong for wrapped lines (F8).
7. `modal.json` validates roots, initial modes, prompt chars, border styles, keymap entries, and reports via `ctx.ui.notify`: holds (`keymap.ts:105-200`, `index.ts:105-107`, `index.ts:122-124`). Unknown keys and never-matching keys are not validated (F10).
8. Clipboard write falls back to stdout and exposes last error; yank keeps selection: holds as written (`editor.ts:151-169`). The stdout fallback runs only when `tui.terminal.write` is not a function, and the host clipboard path is not used (F12).

Other V08 Code Review items: `this as unknown as` removal (`editor.ts:184-199`): holds (no `as unknown` in `editor.ts`). Search/substitution no-op scaffolding: holds for the `/g` and `/`-search paths. `keymap.ts` malformed config and `initialMode` validation: holds.

Regressed: 2 (Resolutions 2 and 4). Not regressed: 6.

## Findings

Severity: high = text loss, crash, or lockout. Medium = wrong behavior, dead config, or large slowdown. Low = ergonomics or simplicity.

### F1 — high — UI (text corruption)

- Current: `editor.ts:137` `text = line.slice(start.col, end.col + 1);` and `editor.ts:181` `const after = line.slice(end.col + 1);`. Selection columns are JS string indices. The host moves the cursor by grapheme (`pi-tui components/editor.js` `moveCursor`, lines ~1593-1598), so `end.col + 1` can split a surrogate pair.
- Gap: `resolveSelection` and `deleteSelection` do not extend the end column to the grapheme boundary.
- Failure: `v`, `d` on the emoji at column 0 leaves a lone low surrogate in the buffer. `y` yanks a lone high surrogate, which is written to the clipboard as broken UTF-8 base64.
- Reproduction: `make("😀x")`, keys `Esc`, `0`, `v`, `d`. Actual text `"\uDE00x"` (lone surrogate, cursor 0). Keys `Esc`, `0`, `v`, `y` on `"😀x"` yank `"\uD83D"`.
- Fix: compute `end` as `start of the grapheme containing end.col` plus its length, using `Intl.Segmenter` (the same segmenter the host uses). Slice on that boundary in both `resolveSelection` and `deleteSelection`.
- Confidence: high (probe output).

### F2 — high — UI (Esc and Ctrl-C lockout; unintended agent interrupt)

- Current: `editor.ts:266-281`: Esc is handled before the search and command branches. In `normal` it calls `super.handleInput(data)` (`:281`), which reaches `CustomEditor` `app.interrupt`. Search branch Esc handler `editor.ts:368-372` and command branch Esc handler `editor.ts:413-416` are unreachable for Esc. Command branch `editor.ts:390-411` returns on every key that is not Enter, Esc, or printable, so Ctrl-C and arrows are swallowed (`:411`).
- Gap: `searchMode` and `commandMode` are not checked before the global Esc branch, and the prompt branches never forward control keys.
- Failure: Esc while typing `/` or `:` triggers `app.interrupt` (aborts a running agent turn) and leaves the prompt active. Ctrl-C is dropped. Every printable key goes into the hidden query until Enter, so the buffer cannot be edited.
- Reproduction: `make("hello", {}, {app: (d,a)=> a==="app.interrupt" && d==="\x1b"})`. Keys `Esc`, `:`, `Esc` records `interrupt`. Then `l`, `o` leaves text `hello`, cursor col 5. Keys `Esc`, `/`, `Esc`, `x` records a second interrupt and leaves text `hello`. Keys `Esc`, `:`, `\x03` leave the prompt active (Enter is then required).
- Fix: at the top of `handleInput`, route to the search or command branch when either flag is set, before the Esc branch. On Esc, clear `searchMode` or `commandMode` and return without calling super. For other control keys during a prompt, clear the prompt and call `super.handleInput(data)`.
- Confidence: high.

### F3 — medium — UI (non-BMP keypress inserted in normal and visual mode)

- Current: `editor.ts:680-687` `printableKey`: `if (data.length === 1 && data.charCodeAt(0) >= 32) return data;`. A single emoji is `data.length === 2`, `parseKey` returns undefined, so `printable` is undefined. Normal mode then falls through to `super.handleInput` (`editor.ts:491`), and visual mode does the same (`editor.ts:355`).
- Gap: single ASCII and BMP characters are swallowed in normal mode, but non-BMP characters are inserted. The host has `decodePrintableKey` (`pi-tui keys.d.ts:182`), which is not exported from the package root (`index.d.ts` exports only `decodeKittyPrintable`), so the modal reimplements the check with the bug.
- Failure: typing an emoji in normal mode inserts it while the mode stays `normal`.
- Reproduction: `make("")`, keys `Esc`, then `handleInput("😀")` yields text `😀`, mode `normal`. Typing `x` in the same state leaves the text empty.
- Fix: classify printable by code point: `[...data].length === 1 && !/^[\x00-\x1f\x7f]/.test(data)`, and treat any non-escape string with a code point ≥ 32 as printable. Apply in both normal and visual.
- Confidence: high.

### F4 — medium — UI (undo is dead in normal mode)

- Current: `keymap.ts:32` `u: "\x1a"`; `vimkeys.ts:13` documents `"\x1a": "undo"`. The host undo is `tui.editor.undo` = `ctrl+-` (`pi-tui keybindings.js:73`), which sends `\x1f`. `\x1a` is not bound to anything, so `super.handleInput("\x1a")` does nothing.
- Gap: the default was written for a different key id.
- Failure: `u` in normal mode silently does nothing. The help screen advertises it.
- Reproduction: `make("")`, keys `a`, `b`, `Esc`, `u` → text `ab`. Keys `a`, `b`, `Esc`, `\x1f` → text `` (undo works).
- Fix: `keymap.ts:32` → `u: "\x1f"`, and `vimkeys.ts:13` stays as is.
- Confidence: high.

### F5 — medium — UI (`o` does not open a line)

- Current: `editor.ts:471` `super.handleInput("\x05\n"); // End of line + newline`.
- Gap: the host checks each `handleInput` call as one key. `"\x05\n"` is neither Ctrl-E nor a newline key (`pi-tui components/editor.js` newline check, lines ~724-735, requires `charCodeAt(0) === 10` for length > 1).
- Failure: `o` enters insert mode but does not create a new line, so the next typed character joins the current line.
- Reproduction: `make("abc")`, keys `Esc`, `o`, `z` → text `abcz`, cursor col 4 (expected `abc\nz`).
- Fix: `super.handleInput("\x05"); this.insertTextAtCursor("\n");` (`insertTextAtCursor` is public, `editor.d.ts:121`).
- Confidence: high.

### F6 — medium — UI (search and `:%s` put the cursor on the wrong line or column)

- Current: `editor.ts:204-220` `moveCursorTo` sends `targetLine - current.line` up or down arrows and `targetCol` right arrows, then `\x01`. Up and down arrows move by visual (wrapped) row (`pi-tui components/editor.js` `moveCursor` deltaLine branch). Right arrows move by grapheme. `findMatch` (`editor.ts:222-260`) uses code-unit indices.
- Gap: the replay assumes one visual row per logical line and one code unit per arrow.
- Failure: a match on a logical line that follows a wrapped line lands on the wrong line. A match after an emoji lands one grapheme past the match.
- Reproduction: `make("needle\n" + "a".repeat(200), {}, {width: 80})`, keys `Esc`, `/`, `n`,`e`,`e`,`d`,`l`,`e`, `Enter` → cursor `{line:1,col:0}` (expected `{line:0,col:0}`). `make("😀😀y")`, keys `Esc`, `0`, `/`, `y`, `Enter` → cursor col 5 (expected col 4).
- Fix: depends on F7. A host `setCursor(line, col)` removes the arrow replay. Until pi-tui exposes one, the fallback is to move visually with `getCursor` checks and grapheme counts. UNVERIFIED: a pi-tui cursor setter is not in `editor.d.ts`, so this needs a host change.
- Confidence: high for the probes; the fix requires a host API.

### F7 — medium — Performance (quadratic cursor replay)

- Current: `editor.ts:212-218` sends one arrow per column through `super.handleInput`. Each arrow calls host `moveCursor`, which calls `buildVisualLineMap` over the whole buffer (`pi-tui components/editor.js:1582`).
- Gap: cost per arrow is O(buffer), and arrows per move are O(target column). Search and `:%s` restore are both O(n²).
- Failure: measured on a single line of `a`×N followed by `zq`, search `/zq` + Enter:

  | Line length | Time |
  |---|---|
  | 500 | 137 ms |
  | 2000 | 1428 ms |
  | 8000 | 21945 ms |

  A prompt of about 8 KB freezes the TUI for about 22 s on one search.
- Reproduction: `node perf3.mjs 8000` from `/tmp` probe (described above): `make("a".repeat(8000)+"zq")`, `Esc`, `0`, `/zq`, `Enter`.
- Fix: same as F6. Batch by line with a host setter. Nothing in this slice can make the arrow replay sub-quadratic.
- Confidence: high (measured).

### F8 — medium — UI (visual highlight missing when lines wrap)

- Current: `editor.ts:637` `const scrollOffset = Math.max(0, cursor.line - (contentLines - 1));` counts logical lines. The host scrolls visual rows (`pi-tui components/editor.js:412-422`).
- Gap: `contentLines` is a visual-row count, but `scrollOffset` is applied as a logical-line offset.
- Failure: with 20 lines of 203 columns at width 80 and the cursor on line 19, no row contains `\x1b[7m`. The cursor line is off screen for the highlight mapping, so `v` shows nothing. Unwrapped 20 lines highlight row 12.
- Reproduction: `text = Array.from({length:20}, (_,i)=> "L"+String(i).padStart(2,"0")+"x".repeat(200)).join("\n")`, `make(text, {}, {width:80, rows:40})`, `Esc`, `v`, `render(80)` → zero highlighted rows. Replace the `x` run with nothing and rerun → row 12 highlighted.
- Fix: derive the visible logical-line range from the host row layout, not from a logical count. Requires access to the wrapped rows. UNVERIFIED whether `wordWrapLine` (exported from `pi-tui components/editor.d.ts`, not from the package root) can be used.
- Confidence: high (probe output).

### F9 — medium — UI (text hidden at wrap boundary)

- Current: `editor.ts:618-623`: `contentWidth = width - promptWidth - 1` (bordered) or `width - promptWidth` (none), and each host line is `truncateToWidth`'d to that width. The host wraps at `layoutWidth = contentWidth - 1` when padding is 0 (`pi-tui components/editor.js:396-399`, `super.render(width)` at `editor.ts:604`).
- Gap: the modal decorates host output after the host laid it out for a wider area.
- Failure: the rightmost 2 columns (bordered) or 1 column (none) of every wrapped row are cut. A 2-column emoji on the last column disappears completely.
- Reproduction: `make("0123456789ABCDEFGHIJ0123456789", {borderStyle:"rounded"}, {width:20})`, `Esc`, `render(20)` → row 1 `❯ 0123456789ABCDEFG│`. `HI` is not displayed. `make("x".repeat(17)+"😀😀", {borderStyle:"none"}, {width:20})` → row 1 `❯ xxxxxxxxxxxxxxxxx ` (no emoji).
- Fix: call `super.render` with the width that makes the host's layout width equal `contentWidth`, and rebuild the top and bottom borders at the full width (the overrides at `editor.ts:557-601` already do this).
- Confidence: high.

### F10 — medium — Backend (config keys validated by value only; dead keys accepted silently)

- Current: `keymap.ts:82-100` `keymap()` checks only that each value is a string or null. `keymap.ts:105-200` `loadModalConfig` checks known top-level fields by name and ignores others. Lookups are by a single raw character (`editor.ts:452` `input in this.keymaps.normal`, `editor.ts:346` for visual).
- Gap: keys that can never match, and unknown top-level keys, produce no diagnostic.
- Failure: `{"initalMode":"normal"}` loads as `insert` with no warning. `{"keymaps":{"normal":{"gg":"\x1b[A"}}}` is accepted and never fires. `ctrl+x` in `visual` is accepted and never fires.
- Reproduction: write `modal.json` with `{"initalMode":"normal","keymaps":{"normal":{"gg":"\u001b[A","z":"x"}}}` and call `loadModalConfig(dir, cb)`. `cb` receives no messages. `initialMode` is `insert`. Keys remain `["gg","z"]`.
- Fix: validate that each keymap key is a single printable character (`[...key].length === 1`), reject others with a diagnostic, and reject unknown top-level keys with a diagnostic naming the nearest known key.
- Confidence: high.

### F11 — medium — Backend (visual `y`, `d`, `x`, `c` overrides ignored)

- Current: `editor.ts:311`, `:323`, `:335` check `input === "y"`, `"d"`, `"x"`, `"c"` before the keymap lookup at `editor.ts:346`. `keymap.ts` visual defaults set those keys to `null`, so the defaults are dead and user overrides are dead.
- Gap: the hardcoded branches run first.
- Failure: a user who maps `visual.y` to a movement sees `y` still yank.
- Reproduction: `make("abc", {keymaps:{visual:{y:"\x1b[D"}}})`, keys `Esc`, `0`, `v`, `l`, `y` → yank `ab`, mode `normal`.
- Fix: check the keymap first in visual, and let `null` mean "use the built-in action". Or drop `y`, `d`, `x`, `c` from `DEFAULT_VISUAL_KEYS` and document them as fixed.
- Confidence: high.

### F12 — medium — Seams (yank bypasses the host clipboard)

- Current: `editor.ts:151-169` builds an OSC 52 sequence and writes it with `this.tui.terminal.write`. The host exports `copyToClipboard` (`pi-coding-agent index.d.ts:39`, `utils/clipboard.js`). That helper tries the native clipboard, WSL, and OSC 52, and skips OSC 52 above 100,000 encoded bytes.
- Gap: duplicate seam. The modal's copy has no native path and no size cap. `clipboardError` is set only if `write` throws, which it does not when a terminal ignores OSC 52.
- Failure: on a local terminal without OSC 52 support, `y` succeeds in the modal and the system clipboard is unchanged. A selection over 100 KB is written as an OSC 52 sequence the terminal may drop.
- Reproduction: `make("abc")`, keys `Esc`, `v`, `l`, `y`. Code path (read, not probed): `copyToClipboard` at `editor.ts:151-169` always writes OSC 52 and never sets `clipboardError` unless `write` throws. Clipboard result on a real terminal: UNVERIFIED.
- Fix: call the host `copyToClipboard(text)` (async), catch the rejection into `clipboardError`, and keep `yankedText` as is.
- Confidence: high for the duplicate path; medium for the user-visible effect (UNVERIFIED on real terminals).

### F13 — medium — Robustness (stale codemode script after session switch)

- Current: `index.ts:64-66` `lastCodemodeCode` and `lastToolCall` live in the extension closure. `index.ts:69-85` reads the cache first and reads `lastCodemodeFromSession` only when the cache is empty. `index.ts:121` `session_start` does not clear the cache. The host runs `resetExtensionUI` before session invalidation (`interactive-mode.js:367`), but the extension instance is not reloaded.
- Gap: state is not reset on session change, and the session source is read after the cache.
- Failure: after `/new`, `ctrl+shift+o` shows the previous session's last codemode script even when the new session has none.
- Reproduction: `/tmp` probe with a fake `pi`: fire `tool_call` `{toolName:"codemode", input:{code:"SESSION_A_SCRIPT()"}}`, then run the `ctrl+shift+o` handler with `sessionManager.getBranch()` returning `[]`. Viewer contains `SESSION_A_SCRIPT()`.
- Fix: clear `lastCodemodeCode` and `lastToolCall` on `session_start`, and prefer `lastCodemodeFromSession(ctx)` over the cache.
- Confidence: high (probe output).

### F14 — medium — UI (`:%s/old/new/` without `g` replaces only the first match in the buffer)

- Current: `editor.ts:396` `const subMatch = cmd.match(/^:%s\/([^/]*)\/([^/]*)\/(g?)$/);` and `editor.ts:403-404` `text.replace(from, to)` on the whole text.
- Gap: `%` means every line. Vim without `g` replaces the first match on each line. The code replaces the first match in the buffer only.
- Failure: `aa\naa` with `:%s/a/b/` becomes `ba\naa`. Vim gives `ba\nba`.
- Reproduction: `make("aa\naa")`, keys `Esc`, `:`, `%`, `s`, `/`, `a`, `/`, `b`, `/`, `Enter` → `ba\naa`.
- Fix: for the non-`g` form, replace the first occurrence per line (`text.split("\n").map(l => l.replace(from, to)).join("\n")`).
- Confidence: high.

### F15 — low — UI (Enter in visual mode keeps VISUAL with a stale anchor)

- Current: `editor.ts:303-335` visual branch has no Enter case. Enter falls through to `super.handleInput` (`editor.ts:355`). Submit clears the buffer through the host (`pi-tui components/editor.js:1138-1151`), but `selectionAnchor` and `mode` are not reset.
- Failure: after submit, mode is still `visual` and the next letters are swallowed until a visual key or Esc.
- Reproduction: `make("abc")`, keys `Esc`, `v`, `Enter` → mode `visual`, text `` (probed). A later printable key such as `q` is dropped by `editor.ts:355` (code read, not probed).
- Fix: on submit in visual mode, set mode to the configured `initialMode` and clear the anchor, or intercept Enter in visual mode.
- Confidence: high.

### F16 — low — UI (normal-mode Backspace is swallowed)

- Current: `printableKey` (`editor.ts:680-687`) returns `\x7f` as printable (charCode 127 ≥ 32), so `editor.ts:491` returns early.
- Failure: Backspace does nothing in normal mode. Vim moves left, so this is a missing motion, not a crash.
- Reproduction: `make("abc")`, keys `Esc`, `BS` → text `abc`, cursor col 3.
- Fix: exclude `\x7f` from printable (same change as F3).
- Confidence: high.

### F17 — low — UI (render overflows at width 1–2)

- Current: `editor.ts:603-623`: the gutter `"❯ "` is 2 columns and is always prepended when `borderEnabled` is false, so at width 1 the line is 2 columns.
- Gap: no width guard. Separately, `Editor.render` in pi-tui throws `Maximum call stack size exceeded` for a 2-column grapheme at width 1 or 2, with or without the modal (host bug, reproduced on the plain `Editor`).
- Failure: at width 1 or 2 the modal output exceeds the width. The host throw propagates out of `render`.
- Reproduction: `make("😀", {}, {width:1})`, `render(1)` throws. `make("hello world wide")`, `render(1)` returns rows of width 3 (probed). A plain `new Editor` with `😀` and width 2 throws the same error.
- Fix (modal): when `width < 3`, return `super.render(width)` unchanged, or truncate the gutter. Host overflow: report to pi-tui.
- Confidence: high for the probes. Real terminals at width ≤ 2: UNVERIFIED.

### F18 — low — UI (split bracketed-paste chunk in normal mode)

- Current: `editor.ts:452-491`: a single `x` chunk is swallowed (`:491`), and the host receives the next `\x1b[201~` after `input in this.keymaps.normal` maps `x` to `\x1b[3~` (`keymap.ts:31`). That sequence is pasted as `[3~`.
- Gap: the modal sees paste content one key at a time.
- Failure: `"\x1b[200~"`, `"x"`, `"\x1b[201~"` in normal mode inserts `[3~`. Live input is re-wrapped as one chunk (`pi-tui terminal.js:173-176`), so this needs a split delivery. Live split delivery: UNVERIFIED.
- Reproduction: `make("")`, keys `Esc`, `"\x1b[200~"`, `"x"`, `"\x1b[201~"` → text `[3~`. Same sequence in insert mode → `x`.
- Fix: while the host is in paste (`this.isInPaste`), pass all input to `super`. Or detect `\x1b[200~` in `handleInput` before the mode switch.
- Confidence: high for the probe; low impact on live paths.

### F19 — low — Simplicity (dead accessors, duplicate helper)

- Current: `editor.ts:68-101` `getPromptChar`, `getSelectionAnchor`, `getYankedText`, `getClipboardError`, `getSelection`, `getKeymaps` are referenced only by `index.test.ts` (lines 315-587). `index.ts:8` `export * from "./keymap.js"` has no importer in the repo. `editor.ts:680-687` `printableKey` duplicates `decodePrintableKey` (F3).
- Failure: public surface grows without a consumer. The duplicate helper has the F3 bug.
- Fix: remove unused getters after tests stop reading them, and use the host helper or delete `printableKey`.
- Confidence: high.

### F20 — low — Simplicity (test harness hides host key handling)

- Current: `index.test.ts:69` `matches: vi.fn(() => false)`. Keybindings never match, and no test uses a non-BMP character, a wrapped line, or a `:`/`/` Esc.
- Gap: the suite cannot catch F1, F2, F3, F5, F6, F8, or F9. `npm test` passes at baseline while those defects exist.
- Fix: add cases for the probes above (emoji delete, Esc in `/`, `o`, wrapped search, wrap width at 20 and 80).
- Confidence: high.

## Failure modes

- Non-BMP text (emoji, some CJK extensions) corrupts visual delete and yank (F1), misplaces the cursor (F6), and leaks into normal mode (F3).
- Esc during `/` or `:` aborts the agent and keeps the prompt active (F2). Ctrl-C is dropped during the same prompt.
- Long single-line prompts (about 8 KB) freeze the TUI for about 22 s on one search (F7).
- Wrapped prompts hide the rightmost 1–2 columns per row (F9) and the visual highlight disappears (F8).
- `u`, `o`, and the `:%s` no-`g` form do not do what the docs say (F4, F5, F14).
- A stale codemode script appears after `/new` (F13).
- Dead config keys and typo'd top-level keys produce no diagnostic (F10, F11).

## Seams

- ModalEditor drives the host `Editor` by replaying key sequences through `super.handleInput` (`editor.ts:204-220`, `:465-471`, `:479`). This couples the modal to host key ids and to host layout rules, and it causes F5, F6, and F7. The host public surface already has `insertTextAtCursor` (`editor.d.ts:121`), `copyToClipboard` (`pi-coding-agent index.d.ts:39`), and `getCursor`. The modal uses none of the cursor-setting path, and it uses `tui.terminal.write` instead of `copyToClipboard`.
- `CustomEditor` app actions are bypassed for Esc (`editor.ts:266-281`). The host expects `app.interrupt` to be checked in `CustomEditor.handleInput` (`custom-editor.js`). The modal calls `super` only in normal mode, so `app.interrupt` in insert or visual mode is never reached.
- Keymaps are keyed by raw character (`editor.ts:346`, `:452`), while the config and docs read like key ids (`ctrl+x`). The seam between config format and lookup is the source of F10.
- Shared packages: `packages/core/border` (`editor.ts:14`) is used for border glyphs only. `packages/tui` is used through `showCodeViewer` (`index.ts:9`). The F3 duplicate and F12 duplicate are the two places where the slice does not use shared helpers. No issue found in `packages/core` modes or prompt lock from this slice.
- Bundled features: `index.ts` also owns `/expand`, `ctrl+shift+o`, `ctrl+shift+k`, and `working.ts`. These are not editor features, and their state lives in the same closure (F13).

## Rejected defaults

- Esc in normal mode calls `app.interrupt` (`editor.ts:281`). This is the host default; the modal passes it through on purpose.
- Enter in normal mode submits (host behavior via `super`). Vim does not submit, but the host default is kept.
- Printable keys are swallowed in normal mode (`editor.ts:491`). This is Vim behavior; `d`, `p`, `y`, and counts are not in R40 or R46 scope.
- No counts (`3l`), no `dd`, no `p`. Not required by `artifacts/requirements.md` R40, R46.
- `enabled: false` works after `/reload`: the host calls `setCustomEditorComponent(undefined)` during `resetExtensionUI` (`interactive-mode.js:1914`), so the default editor is restored before `session_start`.
- Modal render costs more than the host (0.73 ms vs 0.50 ms per `render(80)` at 1000 lines, measured). This is about 0.2 ms per frame. Not optimized.
- Keystroke handling is cheap (7 ms for 20 inserts on a 4 KB buffer); host `render` dominates frame cost (about 1.5 ms per render at 1 KB). No change recommended.
- Fuzz (400 random 150-key runs at widths 3, 7, 20, 80, 200, mixed modes, control and paste sequences): zero thrown errors, zero width overflow, zero cursor out-of-bounds. Width 1–2 is excluded (F17).

## Open Questions

- R53 and D125 claim syntax highlighting for `pi-modal` (`artifacts/requirements.md:280`, `artifacts/decisions.md:521`). No implementation exists (`grep highlight` finds only selection highlighting). Is R53 done, or should the status be reopened?
- Should the modal use the host kill ring and `ctrl+y` (`tui.editor.yank`) instead of its own `yankedText`? The host already has one.
- Does the theme object captured at session start (`index.ts:130`, `ctx.ui.theme`) update after a theme switch? UNVERIFIED.
- Should normal mode accept counts and `d`/`p`? Requirements do not say.

## Verdict

fail

Two high findings (F1 text corruption on emoji delete and yank; F2 Esc during `/` and `:` aborts the agent and drops control keys). Two prior resolutions regressed (2 and 4). Medium findings F3–F14 are fixable within the slice except F6/F7/F8, which need a host cursor setter or a row-aware layout.
