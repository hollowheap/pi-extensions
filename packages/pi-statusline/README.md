# pi-statusline

Lualine-style configurable statusline footer for the Pi coding agent. Define `sections.a` through `sections.z`, each a list of `{ "type", ...options }` components. Sections `a`–`m` pin to the left, `n`–`z` pin to the right.

## Try it

```bash
pi -e ./packages/pi-statusline
```

## Install

```bash
pi install npm:@my-scope/pi-statusline
```

Do not enable another footer extension at the same time; the last one to load wins.

## Configure

Create `<agentDir>/statusline.json` (`~/.pi/agent/statusline.json`). Missing file falls back to the default below; problems are reported once per session and fall back per-field.

```json
{
  "options": {
    "componentSeparator": " ",
    "sectionSeparator": "  ",
    "gitIntervalMs": 5000
  },
  "sections": {
    "a": [{ "type": "mode" }],
    "b": [{ "type": "git_branch" }, { "type": "cwd" }],
    "y": [{ "type": "tokens" }, { "type": "context" }],
    "z": [{ "type": "model" }, { "type": "clock" }]
  }
}
```

Minimal two-section example:

```json
{
  "sections": {
    "a": [{ "type": "cwd", "depth": 2 }],
    "z": [{ "type": "clock", "format": "HH:mm" }]
  }
}
```

Configuring `sections` replaces the defaults entirely. Unknown component types and malformed entries are skipped with a warning.

## Separators

`componentSeparator` (between components) and `sectionSeparator` (between sections) accept a plain string or a styled object:

```json
{
  "options": {
    "componentSeparator": { "text": "|", "fg": "dim" },
    "sectionSeparator": { "text": " ", "bg": "selectedBg", "bold": true }
  }
}
```

`fg` takes a foreground theme token (`dim`, `accent`, `muted`, …) or a `#rrggbb` color; `bg` takes a background token (`selectedBg`, `toolSuccessBg`, …) or a `#rrggbb` color. `bold` takes a boolean. Invalid values are ignored with a warning, so a typo never breaks rendering. Plain strings skip styling entirely.

## Built-in components

| type | shows | options |
|---|---|---|
| `mode` | `WORKING` while the agent runs, else `IDLE` | `idleText`, `workingText` |
| `cwd` | working directory | `depth` (last N segments), `homeAsTilde` (default `true`) |
| `git_branch` | current branch, hidden outside a repo | `icon` |
| `git_diff` | `+a ~m -r ?u` file counts, refreshed in background | `addedIcon`, `modifiedIcon`, `removedIcon`, `untrackedIcon` |
| `model` | active model id | `shorten` (strip `provider/` prefix, default `true`) |
| `tokens` | session `↑input ↓output` | `showInput`, `showOutput` |
| `cost` | session spend | `decimals` (default `3`), `prefix` (default `"$"`) |
| `context` | context window usage percent | — |
| `clock` | current time | `format` (`YYYY MM DD HH mm ss`, default `"HH:mm"`), `intervalMs` |
| `text` | static string | `text` |

Empty output (e.g. `git_branch` outside a repo) is removed before joining, so separators never dangle.
