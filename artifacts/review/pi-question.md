# Review — pi-question (V09)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`


## Requirements Review

N/A — package robustness review; traceability is recorded in the Code Review findings.

## Design Review

N/A — package robustness review; see `artifacts/architecture.md`.

## Specification Review

N/A — package robustness review; verify commands are recorded under Code Review.

## Plan Review

N/A — package robustness review; tasks remain in `artifacts/plan.md`.

## Code Review

### Public Seams

- `questions.ts` exports — `Question`, `QuestionAnswer`, `QuestionMode`, `MAX_ANSWER`, `WRITE_IN_LABEL`, `capAnswer`, `parseQuestionBlock`, `evaluateCondition`, `formatAnswers`.
- `index.ts:22` — `ANSWERS_TYPE` is **not** exported (seam gap).
- No `createQuestionExtension` factory (unlike pi-agent); registered directly in default export.

### Robustness Issues

- `index.ts:337-339` — `event.message.content.flatMap(...)` assumes array content; throws if content is a string.
- `index.ts:334-363` — async `message_end` handler has no try/catch.
- `index.ts:349` — `handled.add` occurs before `askQuestions`; thrown/cancelled flow still marks message handled.
- `index.ts:271-280` — `contentText` assumes array items have `.type`/`.text`.
- `index.ts:220-255` RPC single-select and `askMulti` (55-178) — no validation that `ctx.ui.select`/`input` exist.
- `index.ts:518-543` RPC multi-select — `rows.indexOf(picked)` can misclassify if option labels collide with `"Done"`/`"Write-in answer"`.
- `questions.ts:133-166` — `evaluateCondition` returns `true` for unrecognized conditions.
- `questions.ts:79-116` — `parseQuestionBlock` marks entire block invalid if any unordered list appears.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `index.ts:55-218` — `askMulti` maintains TUI and RPC implementations with duplicated toggle/submit logic. | R17, D47 | **Required, not overengineering.** D47 explicitly specifies a custom TUI checkbox dialog for multi-select and an RPC select-loop with toggle rows plus Done. Two presentation paths are the requirement. |
| `index.ts:293-311` — `stripQuestionBlocks` manually splices by offsets. | R17, D49 | **Required, not overengineering.** D49 requires the raw block to be removed from TUI display only via a markdown transformer. Offset splicing is the mechanism; a simpler string replace would violate the exact-block contract. |
| `index.ts:36-45` — `MultiResult`/`AnswerDetails` internal interfaces. | No R/D | **Not overengineering.** Both are TypeScript compile-time shapes with zero runtime cost; they make the TUI/RPC result and message-details contracts readable. Remove this from the overengineering list. |
| `index.ts:47-53` — `printableKey` plus kitty-decode branch for one call site. | R17, D53 | **Required, not overengineering.** R17/D53 require a capped write-in answer, which needs printable-key filtering in the custom TUI dialog. Kitty decoding is the terminal-compatibility branch for the same input path. |

### Resolution (2026-10-30)

- `ANSWERS_TYPE` is exported for external renderers.
- Assistant content accepts strings, arrays, and malformed blocks without throwing.
- `message_end` catches failures, reports them, and clears the handled mark so a retry can run.
- `secure` dialog wrappers check whether `select`/`input` exist before calling them.
- RPC multi-select uses `Done` as a reserved label; duplicate and reserved option labels are rejected, so row lookup cannot collide.
- Unknown conditions evaluate false instead of true; skipped questions keep their source index for later conditions.
- Page metadata groups questions; pages ask in order with Next/Back navigation. Back clears the current/previous page answers and re-asks.
- Unordered prose before the first H2 is ignored; unordered option lists under a question remain invalid.
- Tests cover string content, missing UI, dialog failure/retry, conditions, page navigation, duplicate/reserved labels, and unordered prose.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
