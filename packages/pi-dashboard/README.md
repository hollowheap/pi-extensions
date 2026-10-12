# pi-dashboard

Replaces the startup header with a dashboard: built-in ASCII art by default, custom art, or the output of a command re-run on an interval. Every line is padded or truncated to one fixed character width; art lines are centered, command output stays left-aligned.

## Try it

```bash
pi -e ./packages/pi-dashboard
```

## Install

```bash
pi install npm:@my-scope/pi-dashboard
```

## Configure

Create `<agentDir>/dashboard.json` (`~/.pi/agent/dashboard.json`). Missing file shows the built-in banner; problems are reported once per session with field fallbacks.

```json
{
  "width": 60,
  "sections": [
    { "type": "header" },
    {
      "type": "terminal",
      "command": "/home/u/bin/status",
      "args": ["--short"],
      "intervalMs": 30000,
      "gap": 1
    }
  ]
}
```

- `width`: fixed line width, an integer from 10 to 500 (default `60`).
- `header`: static art lines, centered. Omitting `ascii` shows the built-in banner.
- `terminal`: runs `command` with `args` (executable path plus argument array — no shell) and shows its output left-aligned, re-run every `intervalMs` (positive number, default `30000`). Failures render as one error line and warn once.
- `gap`: blank lines after the section (default `0`). Unknown section types are skipped with a warning.

Commands run with your full user permissions. Review any dashboard command before installing it from a third party.
