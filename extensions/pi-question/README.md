# pi-question

Asks the user questions from tagged `'''question` blocks in assistant text. It registers no model tool: the old `question` tool and its TypeBox schema are removed, which is a breaking change for anyone calling it.

Interactive TUI and RPC sessions get sequential dialogs. Print and JSON sessions get no question contract and no dialogs.

## Format

````markdown
'''question
## Which database?
1. PostgreSQL
2. SQLite

## Anything else?
'''
````

- One H2 per question; questions are asked in source order.
- Ordered-list items are options. A question has 0–8 options; zero options asks for free text.
- No checkbox means single-select. Put `[ ]` on every option for multi-select; `[x]` is also a mode marker, not a preselected option.
- Do not add a write-in option. The UI always appends the final `Write-in answer` row, capped at 500 characters.
- Answers return as one numbered follow-up message. The question text is not repeated.

## Behavior

- **TUI:** single-select uses a choice dialog plus write-in input; multi-select uses checkbox rows (Space toggles, Enter opens the inline write-in editor, Enter on Done submits). Zero selections is valid.
- **RPC:** single-select uses the same select/input flow; multi-select uses a select-toggle loop with `[ ]`/`[x]` rows, a write-in row, and Done.
- **Display-only stripping:** the TUI transcript hides valid question blocks. The stored assistant message and model context keep the raw fence. RPC rendering is client-owned, so RPC clients still receive the raw fence.
- **Cancellation:** dismissing any dialog cancels the whole set, sends no follow-up, and does not throw.
- **One message per set:** all questions from one assistant message are answered sequentially, then one `hollowheap.question.answers` follow-up is sent.

## Install

```bash
pi install npm:@hollowheap/pi-question
```

## Try it locally

```bash
pi -e ./extensions/pi-question
```
