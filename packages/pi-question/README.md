# pi-question

Registers one model tool, `question`: asks the user one question and waits for the answer. Use only when a choice cannot be decided from the code or the request.

With `options` (2–4 strings) the user picks from a choice dialog plus an "Other (free-text answer)" entry; without `options` a text dialog is shown. Answers are capped at 500 characters. Fewer than 2 or more than 4 options fail with a validation error, as does dismissing the dialog.

## Try it

```bash
pi -e ./packages/pi-question
```

## Install

```bash
pi install npm:@hollowheap/pi-question
```
