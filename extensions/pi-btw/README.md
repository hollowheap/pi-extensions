# pi-btw

One-shot side questions for the Pi coding agent. `/btw` sends the current
session context plus your question to the active model and shows the answer in
a scrollable dialog. Nothing is appended to the session tree.

## Try it

```bash
pi -e ./extensions/pi-btw
```

## Usage

```text
/btw why does this test fail?
/btw                          # prompts for the question
```

The request uses the current compaction-aware context and a small side-question
system prompt with no tools. It does not save a fork, a message, or a model
response in the transcript. The dialog is read-only; close it with `Esc`.

## Cost

`/btw` resends the active context. On long sessions that is the dominant token
cost, even though the response is capped at 1200 tokens. Cache writes are
disabled for the one-shot request so throwaway side questions do not pollute the
prompt cache.
