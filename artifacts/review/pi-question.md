# pi-question Review

## Public Seams

- `questions.ts` exports — `Question`, `QuestionAnswer`, `QuestionMode`, `MAX_ANSWER`, `WRITE_IN_LABEL`, `capAnswer`, `parseQuestionBlock`, `evaluateCondition`, `formatAnswers`.
- `index.ts:22` — `ANSWERS_TYPE` is **not** exported (seam gap).
- No `createQuestionExtension` factory (unlike pi-agent); registered directly in default export.

## Robustness Issues

- `index.ts:337-339` — `event.message.content.flatMap(...)` assumes array content; throws if content is a string.
- `index.ts:334-363` — async `message_end` handler has no try/catch.
- `index.ts:349` — `handled.add` occurs before `askQuestions`; thrown/cancelled flow still marks message handled.
- `index.ts:271-280` — `contentText` assumes array items have `.type`/`.text`.
- `index.ts:220-255` RPC single-select and `askMulti` (55-178) — no validation that `ctx.ui.select`/`input` exist.
- `index.ts:518-543` RPC multi-select — `rows.indexOf(picked)` can misclassify if option labels collide with `"Done"`/`"Write-in answer"`.
- `questions.ts:133-166` — `evaluateCondition` returns `true` for unrecognized conditions.
- `questions.ts:79-116` — `parseQuestionBlock` marks entire block invalid if any unordered list appears.

## Overengineering

- `index.ts:55-218` — `askMulti` maintains two full implementations (TUI component + RPC loop) with duplicated toggle/submit logic.
- `index.ts:293-311` — `stripQuestionBlocks` manually splices by offsets; complex reverse iteration.
- `index.ts:47-53` — `printableKey` helper plus kitty-decode branch adds abstraction for single call site.
- `index.ts:36-45` — small `MultiResult`/`AnswerDetails` interfaces are internal-only boilerplate.