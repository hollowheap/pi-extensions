# pi-dashboard

Replaces the startup header with a dashboard: built-in ASCII art by default, custom art, or the output of a command re-run on an interval. Every line is padded or truncated to one fixed character width.

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
  "intervalMs": 30000,
  "source": { "command": "/home/u/bin/status", "args": ["--short"] }
}
```

- `width`: fixed line width, an integer from 10 to 500 (default `60`).
- `intervalMs`: re-run period for command sources, a positive number (default `30000`). Art sources never re-run.
- `source.ascii`: custom art lines, shown verbatim.
- `source.command` + `source.args`: executable path plus argument array — no shell. A command wins when both sources are given. Failures render as one error line and warn once.

Commands run with your full user permissions. Review any dashboard command before installing it from a third party.
