# Review — pi-question (V36, robustness re-review)

## Scope

- Slice: `extensions/pi-question` at HEAD (`615d205`), about 653 LOC in `src/index.ts`, `src/questions.ts`, `src/alerts.ts`.
- Working-tree edits in `extensions/pi-agent` ignored as instructed.
- Recent commits (`git log --oneline -10 -- extensions/pi-question`): `615d205`, `98f1994`, `e68aa50`, `64c6f9f`, `09ba45d`, `92606b4`, `d4ad8ad`, `f1053ec`. None is a V36 fix.
- Probes (Lens 2 abort note: `pi-question` registers no model tool, so tool-abort reduces to dialog signal, see F9): Node scripts loaded with jiti from `/tmp/pq-probe`, using a fake `pi` and scripted `ctx.ui`. Probe directory deleted after the run. No repo files changed.
- Host facts used: `ExtensionMode = "tui" | "rpc" | "json" | "print"` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:212`); `ExtensionUIDialogOptions.signal` and `.timeout` at `types.d.ts:36-44`.

## Prior resolutions

V09 (`artifacts/review/pi-question.md`, Code Review > Resolution) and V17 (`artifacts/review/ui-upgrades.md`, pi-question items only).

- V09 `ANSWERS_TYPE` exported: holds (`index.ts:25`).
- V09 string/array/malformed assistant content: holds (`index.ts:333-340` `contentText` returns `""` for non-array).
- V09 `message_end` try/catch with handled-mark clear: holds (`index.ts:403`, `index.ts:429` `handled.delete`).
- V09 dialog wrappers check `select`/`input`: holds (`index.ts:183`, `index.ts:231`, `index.ts:260`, `index.ts:303`).
- V09 RPC `Done` reserved, duplicate/reserved labels rejected: holds (`questions.ts:60-70`); `rows.indexOf` at `index.ts:216` is safe because labels are unique and not `Done`/`Write-in answer`.
- V09 unknown condition evaluates false: holds (`questions.ts:180`).
- V09 skipped questions keep source index for later conditions: holds for condition evaluation (`index.ts:300-301` and `questions.ts:158`). The output numbering does not follow source order; see F1.
- V09 page grouping with Next/Back and Back clearing answers: holds (`index.ts:283-325`). Back on page 1 is a separate defect; see F11.
- V09 unordered prose before first H2 ignored, unordered list under a question invalid: holds (`questions.ts:118-124`).
- V09 tests for the listed cases: holds. Test files exist (`index.test.ts:126,144`, `questions.test.ts:10-31`). Coverage of page Back and duplicate labels not re-checked.
- V17 free-text uses host `ctx.ui.editor()` for prose: holds (`index.ts:229`). Multi-select write-in still uses a one-line draft; see F6.
- V17 every `render(width)` line fits the width: holds at 40, 80, 200 (probe, see F7).
- V17 TUI-only guards via `ctx.mode`/`hasUI`: holds (`index.ts:62`, `index.ts:395`).

Regressed prior resolutions: 0.

## Cross-slice impact

- V20 F1 (prompt lock never released when a host overlay is hidden without `done`): `pi-question` multi-select holds the lock at `index.ts:63-64` for the whole dialog. A hidden overlay leaves the lock held, so every later question in the session, and every other extension using `withPromptLock`, stops at the lock. The `message_end` handler never reaches its `catch`.
- V20 F2 (picker key hint clipped at 20 rows): not a V20 defect here, but the same class applies. The key hint line `index.ts:170` is the last row of a dialog that reaches 63 rows with a long prompt (F7). It would be clipped first.
- V22 F4/F5 (no timeout on prompt lock; timer-scheduled prompts throw): `pi-question` passes no `timeout` or `signal` to `select`/`input`/`custom` (`index.ts:63-64`, `196-197`, `261-262`, `303-305`). A question left unanswered waits forever. The flow starts from `message_end`, not a timer, so F5 does not reach this slice.

## Findings

Order: high first. Each reproduction ran against HEAD through the probe harness described under Scope unless marked UNVERIFIED.

### F1 — high — Backend (result shape)

- `index.ts:328` and `index.ts:421-424`:
  ```ts
  return answers.filter((answer): answer is QuestionAnswer => answer !== undefined);
  ...
  content: formatAnswers(answers),
  ```
  `questions.ts:183-186`: `answers.map((answer, index) => \`${index + 1}. ...\`)`.
- Gap: the filter removes skipped slots before numbering, so the number is the position among answered questions, not the source position. The message also omits the question text. `README.md:21` says "Answer numbers follow source order, including skipped questions."
- Impact: when a `[if:]` question is skipped, later answers shift down one number. The model reads `2. b` as the answer to question 2, which is question 3.
- Reproduction (probe A, passed): source `## Ship?` (Yes/No), `## Env? [if: answer1 == 'Yes']`, `## Notify?` (a/b). Scripted answers Ship=`No`, Notify=`b`. Env not asked. Follow-up content: `"1. No\n2. b"`.
- Fix: keep the source-indexed array and emit `${sourceIndex + 1}. ${prompt}: ${answer}` for answered questions only, or emit `skipped` for skipped slots. Put the prompt text in the content so the model needs no positional lookup.
- Confidence: high (probe output).

### F2 — medium — Robustness (cancel semantics)

- `index.ts:417`: `if (answers === undefined || answers.length === 0) return;`. Cancel paths: `index.ts:199`, `index.ts:264`, `index.ts:298`, `index.ts:310`, and `index.ts:252`.
- Gap: Esc or host `undefined` on any question or page prompt discards every answer already given and sends nothing to the model. The model gets no cancel signal.
- Impact: a user who answers pages 1-2 and cancels page 3 loses the page 1-2 answers. The model waits for an answer that never arrives, with no message in the transcript to explain why.
- Reproduction (probe B, passed): two single-select questions; the host returns `"Yes"`, then `undefined` on Q2. `pi.sendMessage` call count: 0.
- Fix: on cancel, send a follow-up such as `Question dialog cancelled; answers discarded` (or the partial answers with an explicit cancelled flag), so the model can ask again or proceed.
- Confidence: high for "no message sent" (probe). Whether the model should be told is a design choice; see Open Questions.

### F3 — medium — UI (control bytes from model text)

- `index.ts:159-167` (multi-select render):
  ```ts
  const lines = [question.prompt];
  ...
  lines.push(`${pointer} [${mark}] ${option}`);
  ```
  then `index.ts:171` `new Text(lines.join("\n"), 0, 0).render(width)`.
- Gap: prompt and option text come from model output (`questions.ts:60`, `index.ts` via `parseQuestionBlock`) and are rendered without stripping ESC, OSC, or other C0 bytes.
- Impact: a model-written option containing `ESC [2J` or an OSC title sequence changes the user's terminal state inside the dialog. The OSC 52 clipboard write is the worst case; it is not probed.
- Reproduction (probe E, passed): `## Pick \x1b]0;pwned\x07 now?` with `1. [ ] Alpha \x1b[2J`. `comp.render(80)` lines contain `\x1b[2J` and `\x1b]0;`.
- Fix: strip or replace C0/C1 and ESC bytes in `parseQuestionBlock` option and prompt text (one place, `questions.ts:parseQuestionBlock`), and add a test that a control-byte label renders without ESC. Single-select labels pass to the host `ctx.ui.select` (`index.ts:262`), so the host should be checked too (UNVERIFIED).
- Confidence: high for the TUI multi path. Host single-select escaping: UNVERIFIED.

### F4 — medium — Backend (silent whole-block drop)

- `questions.ts:58` `if (cleanPrompt.length === 0 || items.length > 8) return undefined;`, `questions.ts:66-70` (duplicate/reserved label), `questions.ts:75` (mixed checkboxes). In `parseQuestionBlock`, `questions.ts:102` and `questions.ts:123` set `invalid = true`, which makes the whole block `undefined`.
- `index.ts:366-367`: `const remove = block.closed ? parseQuestionBlock(block.body) !== undefined : isStreaming;` means a rejected closed block stays visible as raw fence text.
- Gap: one bad question (nine options, duplicate label) drops every question in the block. The user gets no dialog and no notice, and the model is not told.
- Reproduction (probe D, passed): a block with a nine-option question and a valid second question. `ctx.ui.select` called 0 times, `notify` not called, `pi.sendMessage` 0 calls. `parseQuestionBlock` on nine options returns `undefined`, and on `1. a` / `2. a` returns `undefined`.
- Fix: reject the single question and report it through `ctx.ui.notify` or a follow-up message ("question 1 rejected: more than 8 options"). Keep the valid questions, or reject the whole block with the same message.
- Confidence: high.

### F5 — medium — Backend (no cap on questions per block)

- `questions.ts:100` `questions.push(question);` and `questions.ts:90` `parseQuestionBlock` have no question-count limit. The 8-option cap at `questions.ts:58` is the only bound.
- Gap: a model block with N H2 headings yields N sequential dialogs.
- Impact: a 300-question block parses fully (probe D: `questions in one block: 300`), and the user must answer 300 dialogs before the turn can continue. Each dialog is held under the prompt lock.
- Reproduction (probe D, passed): `parseQuestionBlock` on 300 two-option H2 sections returns 300 questions.
- Fix: cap the count (for example 10), reject the block above the cap with a notice (see F4), and say the cap in `QUESTION_FORMAT` (`index.ts:27-37`).
- Confidence: high for parse behavior. Acceptable cap value: design choice.

### F6 — medium — UI (emoji and paste dropped in multi write-in)

- `index.ts:50-54` `printableKey`: `if (data.length !== 1) return undefined;` after the kitty decode.
- `index.ts:124-127`: the write-in draft accepts only `printableKey(data)` output.
- Gap: in legacy (non-kitty) input, any chunk of more than one UTF-16 unit is dropped. That covers astral-plane emoji (two units) and pasted text (multi-character chunks, including bracketed-paste payloads per `pi-tui/dist/keys.js:376-377`). CJK single units work.
- Impact: a user who types an emoji or pastes a sentence into the multi-select write-in sees nothing change. The free-text path uses the host `editor` (`index.ts:229`) and is not affected, so the two paths behave differently.
- Reproduction (probe E2, passed): in write-in edit mode, `handleInput("😀")` and `handleInput("hello paste")` leave the draft unchanged; `handleInput("中")` appears.
- Fix: accept any chunk whose code points are all printable (`/^[^\p{Cc}]+$/u`) and strip bracketed-paste markers, or move the multi write-in to `ctx.ui.editor` as the free path does.
- Confidence: high for legacy input. Whether the host forwards pastes as one chunk: UNVERIFIED.

### F7 — medium — UI (no height bound; focus can leave the screen)

- `index.ts:159-171`: `render(width)` returns every line (prompt, all options, write-in, draft, Done, hint). No height argument is read and no scroll offset exists.
- Gap: a long model prompt pushes the options, cursor, and Done row past the bottom of the terminal.
- Impact: at width 40 with a roughly 2,000-character prompt and 8 options, the component returns 63 lines. The selected row and Done are at the bottom. On a 24-row terminal they are not visible, so focus is lost. Whether the host clips from the top or bottom is UNVERIFIED.
- Reproduction (probe E3, passed): `render(40)` 63 lines, `render(80)` 37 lines, `render(200)` 22 lines. Max visible width equals the width in all three, so the width requirement holds.
- Fix: window the option list around `cursor` with a visible-count and an `n of m` position, and clamp the prompt to a few rows with a "…" marker. Use the height argument if the host passes one (UNVERIFIED).
- Confidence: high for line count. Visible effect on a short terminal: UNVERIFIED.

### F8 — medium — Robustness (concurrent question flows interleave)

- `index.ts:196`, `index.ts:210`, `index.ts:261`, `index.ts:269`, `index.ts:304`: `withPromptLock` is taken per call, not per flow. Between two calls of one flow, another flow's call can take the lock.
- Gap: `askQuestions` (`index.ts:280-326`) does not hold the lock across its questions. The lock is released after each dialog.
- Impact: two `message_end` handlers that run together produce interleaved dialogs (A1, B1, A2). The user cannot tell which assistant turn a dialog belongs to, and the answers still route to the right follow-up. Holding one flow-level lock would fix the order, but `withPromptLock` throws on nested acquisition (`packages/core/src/prompt-lock.ts`), so the inner calls would have to be lock-free.
- Reproduction (probe C, passed): two `message_end` calls with flows `A1, A2` and `B1`. Ask order `['A1?','B1?','A2?']`. Sent content `['1. m', '1. p\n2. p']`.
- Fix: one flow-level lock around `askQuestions` and lock-free inner helpers, or a single queue in `message_end` that runs flows one after another.
- Reachability: whether the host fires `message_end` for a second assistant message while the first dialog is open is UNVERIFIED. The finding is conditional on that.
- Confidence: high for interleaving. Reachability: low until verified.

### F9 — medium — Robustness (no abort or session-switch handling; UNVERIFIED host behavior)

- `index.ts:63-64` (`ctx.ui.custom`), `index.ts:196-197`, `index.ts:261-262`, `index.ts:303-305`: no `signal` or `timeout` in the dialog options. `ctx.signal` is never read in `src/`.
- Gap: `ExtensionUIDialogOptions.signal` (`types.d.ts:36-44`) exists to dismiss a dialog. This slice never passes it, and there is no `session_switch` handler.
- Impact (if the host does not dismiss on its own): an aborted or switched session keeps the dialog and the prompt lock open. Answers then go through `pi.sendMessage` (`index.ts:419`) into the session that may no longer be current.
- Reproduction: UNVERIFIED. Needs a running TUI host: open a question dialog, abort the agent or switch session, observe whether the overlay closes and whether the lock releases.
- Fix: pass `ctx.signal` (or an extension-owned `AbortController`) to each dialog, call `done(undefined)` on abort, and handle session switch by dropping the flow.
- Confidence: low until the host behavior is checked.

### F10 — low — UI (surrogate split at cap)

- `questions.ts:25-27` `capAnswer`: `text.slice(0, MAX_ANSWER)` counts UTF-16 units. `index.ts:120` backspace `draft.slice(0, -1)` also removes one unit.
- Gap: a cap or backspace that lands between a high and low surrogate leaves a lone surrogate.
- Impact: model context and transcript receive an invalid code point, rendered as a replacement character.
- Reproduction (probe E, passed): `capAnswer("a".repeat(499) + "😀")` ends with `0xd83d`, a lone high surrogate.
- Fix: cut on code points (`Array.from(text).slice(0, MAX_ANSWER).join("")`), and delete one code point in backspace.
- Confidence: high for `capAnswer`. The kitty-driven backspace path: UNVERIFIED.

### F11 — low — Robustness (Back on page 1)

- `index.ts:305-309` offers `BACK_LABEL` after every page, including the first. `index.ts:311-322` on Back sets `answers[index] = undefined` for the current page and the previous one. With `pageIndex === 0`, `previousPage` is undefined, so only the current page is cleared and page 1 is re-asked.
- Impact: choosing Back on page 1 silently wipes that page's answers. There is also no way to revisit the last page (`index.ts:302` breaks before the menu).
- Reproduction (code-read, high confidence): script `ctx.ui.select` to return `Back` for `Question page 1 complete`. Page 1 answers are cleared and the page is asked again.
- Fix: omit Back on the first page; offer Back on the last page too, or document that the last page is final.
- Confidence: high from code.

### F12 — low — Simplicity (test branch in production; unused export)

- `alerts.ts:5-9` `defaultDelivery`: `if (process.env.VITEST !== undefined) return { ... notify: () => false ... }`. Production code branches on the test runner. The same pattern is duplicated in `extensions/pi-statusline/src/alerts.ts:8`.
- `alerts.ts:14` `export async function deliverQuestionAlert` is used only by `alerts.ts:28` and `alerts.test.ts:2`.
- Fix: inject the delivery from the extension factory or test through `vi.mock("@hollowheap/core/alerts")`. Remove the `VITEST` branch.
- Confidence: high.

### F13 — low — Simplicity (duplicated condition branches)

- `questions.ts:154-177`: the `==` and `!=` branches repeat the same answer-to-string switch (`questions.ts:158-164`, `171-177`).
- Fix: one regex with an operator group, one value extraction, one comparison.
- Confidence: high.

## Failure modes

- Skipped conditional question: wrong answer attributed to wrong question (F1).
- User cancels mid-flow: answers discarded, model not told (F2).
- One malformed question: whole block silently dropped; raw fence still shown (F4).
- Model emits many questions: unbounded dialog count (F5).
- Model text with ESC/OSC: escape sequences rendered inside the dialog (F3).
- Long prompt on a short terminal: focus leaves the screen (F7).
- Two turns with questions at once: dialogs interleave (F8, reachability UNVERIFIED).
- Lock held by a hidden overlay: every later prompt in the session blocks (V20 F1).

## Seams

- `ctx.ui.custom` multi-select (`index.ts:62-180`) and RPC select-loop (`index.ts:183-219`) share toggle/submit logic in two forms. V09 accepted this as required by D47; not re-reported.
- `ANSWERS_TYPE` (`index.ts:25`) is the only exported seam used outside the slice (`index.test.ts`). `formatAnswers` (`questions.ts:183`) is the content contract: F1 lives there.
- `alerts.ts` is a thin wrapper over `@hollowheap/core/alerts`; the `VITEST` branch (F12) is the only test seam.

## Rejected defaults

- Per-keystroke render cost: options are capped at 8 (`questions.ts:58`), so the render is at most about 11 rows plus the prompt. No measured problem; no micro-optimization proposed.
- Duplicate seam with `packages/tui` picker: `packages/tui/src/picker.ts` is a fuzzy single-select list with no checkboxes (grep for `multi`/`checkbox` returns nothing). No duplicate checkbox dialog exists in `packages/` or other extensions. Not a finding.
- Tool abort signal (lens 2 item): N/A, no tool is registered (`index.test.ts:88`). Dialog-level abort is F9.
- Print/json inert: by design (`index.ts:395`, `index.test.ts:126`). Not a finding.
- Single-adapter abstraction: none found in the slice.

## Open Questions

- Should a cancelled flow notify the model (F2), and should partial answers be kept?
- Does the host fire `message_end` for a second assistant message while a dialog is open (F8)?
- Does the host clip overlays from top or bottom, and does `Component.render` receive a height (F7, F9)?
- Does the host pass pasted text as one `handleInput` call (F6)?
- Does the host dismiss `custom`/`select` dialogs on abort or session switch without `signal` (F9)?
- Does the host escape control bytes in `ctx.ui.select` labels (F3)?

## Verdict

Not robust enough to rely on for multi-question answers. Fix F1 (high) first: skipped conditionals misnumber answers, which mis-routes the model's reasoning. Then F2 and F4 (silent drops and cancels), F3 (terminal escape injection in the TUI dialog), and F7 (no height bound). No V09 or V17 pi-question resolution regressed (0 of 9 checked). F8 and F9 need the UNVERIFIED host checks before they are treated as confirmed.
