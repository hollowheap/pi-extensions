# pi-question

Asks the user questions through the codemode `question` tool. Tagged question blocks are no longer used.

## Try it locally

```bash
pi -e ./extensions/pi-question
```

## Tool

Call `tools.question({...})` from a codemode script. Parameters:

- `questions`: array of `{ prompt, options?, multi?, page?, condition? }`
- `prompt`, `options`, `multi`: single-question shorthand

A question with no options asks for free text. Single-select omits checkboxes;
multi-select puts `[ ]` on every option. Use `page` to group questions and
`condition` (for example `answer1 == 'Yes'`) to show a question only when an
earlier answer matches. The UI always appends a `Write-in answer` row.

## Behavior

- **TUI:** single-select uses a choice dialog plus write-in input; multi-select uses checkbox rows (Space toggles, Enter opens the inline write-in editor, Enter on Done submits). Zero selections is valid. Free-text and write-in answers use the multi-line `ctx.ui.editor` when available.
- **RPC:** single-select uses the same select/input flow; multi-select uses a select-toggle loop with `[ ]`/`[x]` rows, a write-in row, and Done.
- **Cancellation:** dismissing any dialog cancels the whole set and sends no follow-up.
- **Pages and branching:** pages are answered in ascending order with Next/Back navigation; conditions evaluate against prior answers by source question number.
- **One call per set:** all questions from one tool call are answered sequentially, then the formatted answers are returned.
In the terminal, Shift+Left switches focus between an open question and the
main prompt. Both drafts stay in place. The question frame uses the shared
panel style and is horizontally centered in the prompt slot.
