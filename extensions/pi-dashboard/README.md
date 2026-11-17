# pi-dashboard

Replaces Pi's startup header with an interactive dashboard and live session overview.

## Sections

Default sections render in `72` columns (customizable in `<agentDir>/dashboard.json`):

- `header`: centered ASCII art (`DEFAULT_ART` when `ascii` is omitted).
- `state`: live session snapshot (project, mode, agent, guard trust, model, token/cost/budget, todos, tasks, subagents, memory, LSP, web, hooks, questions, decide).
- `sessions`: recent resumable sessions for the active project (`scope`: `"cwd"` or `"all"`, `maxItems`: `1..20`) with age, message count, agent, open todos, cost, observations, and decide calls.
- `actions`: quick slash-command and shortcut bar.
- `terminal`: runs `command` with `args` every `intervalMs` ms without a shell. Left-aligned by default (`align: "center"` centers output).

Deprecated `"version"` sections in existing `dashboard.json` files are ignored without diagnostics.

## Commands & Lifecycle

- `autoHide` (default `true`): hides the startup dashboard header once a conversation starts or when opening a branch with existing messages.
- `/dashboard`: opens the interactive overlay (`↑↓`/`j`/`k`/`1-8`/`Enter` resume a session, `Tab` toggles project/all scope, `r` refreshes, `s` opens settings, `t`/`a`/`u`/`g` run quick actions, `q`/`Esc` closes).
- `/dashboard settings`: opens the settings modal (`header` banner/none, header `gap`, section toggles, and `autoHide`) and saves to `dashboard.json` while preserving `terminal` sections.

## Configure

```json
{
  "width": 72,
  "autoHide": true,
  "sections": [
    { "type": "header", "gap": 1 },
    { "type": "state", "gap": 1 },
    { "type": "sessions", "maxItems": 5, "scope": "cwd", "gap": 1 },
    { "type": "actions", "gap": 0 }
  ]
}
```
