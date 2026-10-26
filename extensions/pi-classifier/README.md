# pi-classifier

Advisory classifier tool for the Pi coding agent. `decide` asks a configured classifier model one structured question and returns a label, score, or probability with confidence. It is a direct tool, not a policy gate.

## Try it

```bash
pi -e ./extensions/pi-classifier
```

## Install

```bash
pi install npm:@hollowheap/pi-classifier
```

## Configure

Create `<agent-dir>/classifier.json`:

```json
{
  "model": "provider/model-id",
  "timeoutMs": 5000,
  "maxInputChars": 20000,
  "cacheTtlMs": 600000
}
```

`model` is required. It must name a classifier model available through Pi's model registry, in `provider/model-id` form. `cacheTtlMs: 0` disables the session cache.

## Tool

`decide` accepts one question:

- `kind`: `choice`, `score`, or `bool`.
- `input`: the text to classify. It is the only payload sent.
- `question`: instructions for the classifier.
- `choice`: 2–10 `{label, description}` options.
- `score`: 2–10 ordered `{label, description}` levels.
- `bool`: `trueDescription` and `falseDescription`.

Results:

- `choice`: `value`, `probabilities`, `confidence`.
- `score`: `value` (level index), `confidence`.
- `bool`: `value`, `probability`.

All results include `model` and `usage`. A classifier error returns explanatory text instead of throwing.

## Privacy

`decide` sends only `input`, `question`, and the criteria. It does not add cwd, mode, session history, file contents, or tool output. Do not send secrets. Prefer local classifier models for sensitive repositories.

## Limits

- Input defaults to 20,000 characters and caps at 100,000.
- Requests time out after 5 seconds by default.
- Repeated identical calls reuse a per-session result for 10 minutes by default.
- Concurrent identical calls share one request.
- Aborted or failed calls are not cached.

## Trust and policy

`decide` is advisory. It does not mutate files or override `pi-guard`. Use it for ambiguous judgment, such as whether a task is atomic or whether a shell command is sensitive. Do not use it as the only safety check.
