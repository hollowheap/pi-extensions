# pi-decide

Advisory decision tool for the Pi coding agent. `decide` asks a configured decide model one structured question and returns a label, score, or probability with confidence. It is a direct tool, not a policy gate.

## Try it

```bash
pi -e ./extensions/pi-decide
```

## Install

```bash
pi install npm:@hollowheap/pi-decide
```

## Configure

Create `<agent-dir>/decide.json`:

```json
{
  "model": "provider/model-id",
  "timeoutMs": 5000,
  "maxInputChars": 20000,
  "cacheTtlMs": 600000
}
```

`model` is required. It must name a decide model available through Pi's model registry, in `provider/model-id` form. `cacheTtlMs: 0` disables the session cache.

## Tool

`decide` accepts one question:

- `kind`: `choice`, `score`, or `bool`.
- `input`: the text to decide on. It is the only payload sent.
- `question`: instructions for the decide model.
- `choice`: 2–10 `{label, description}` options.
- `score`: 2–10 ordered `{label, description}` levels.
- `bool`: `trueDescription` and `falseDescription`.

Results:

- `choice`: `value`, `probabilities`, `confidence`.
- `score`: `value` (level index), `label`, `confidence`.
- `bool`: `value`, `probability`.

All results include `model` and `usage`. A decide error returns explanatory text instead of throwing.

## Privacy

`decide` sends only `input`, `question`, and the criteria. It does not add cwd, mode, session history, file contents, or tool output. Do not send secrets. Prefer local decide models for sensitive repositories.

## Limits

- Input defaults to 20,000 characters and caps at 100,000.
- Requests time out after 5 seconds by default.
- Repeated identical calls reuse a per-session result for 10 minutes by default.
- The per-session cache holds at most 128 results and evicts the least-recently-used entry.
- Concurrent identical calls share one request.
- The shared request is aborted when its last waiting caller cancels.
- Aborted or failed calls are not cached.

## Trust and policy

`decide` is advisory. It does not mutate files or override `pi-guard`. Use it for ambiguous judgment, such as whether a task is atomic or whether a shell command is sensitive. Do not use it as the only safety check.
