# pi-statusline

Lualine-style configurable statusline footer for the Pi coding agent. Define `sections.a` through `sections.z`, each a list of `{ "type", ...options }` components. Sections `a`–`m` pin to the left, `n`–`z` pin to the right.

## Try it

```bash
pi -e ./packages/pi-statusline
```

## Install

```bash
pi install npm:@hollowheap/pi-statusline
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
  "extensions": ["mode-guard", "budgets"],
  "sections": {
    "a": [{ "type": "mode-guard" }],
    "b": [{ "type": "git_branch" }, { "type": "cwd" }],
    "y": [{ "type": "tokens" }, { "type": "context" }, { "type": "budgets" }],
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

`fg` takes a foreground theme token (`dim`, `accent`, `muted`, …), a starship color (`red`, `bright-blue`, …), a 0–255 palette index, or a `#rrggbb` color; `bg` takes a background token (`selectedBg`, `toolSuccessBg`, …) or any of the same color forms. `bold` takes a boolean. Invalid values are ignored with a warning, so a typo never breaks rendering. Plain strings skip styling entirely.

## Built-in components

Every component also accepts `fg`, `bg`, and `bold` with the same values as separators, so components are never rendered plain unless configured that way:

```json
{
  "sections": {
    "a": [{ "type": "mode", "fg": "bright-white", "bg": "blue", "bold": true }],
    "z": [{ "type": "clock", "fg": "dim" }]
  }
}
```

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
| `thinking` | current thinking level, blank when unknown | — |
| `text` | static string | `text` |

## Pill styling

Components accept `accent` (and optional `icon`, `iconSide`, `iconFg`, `iconBg`, `leftCap`, `rightCap`) to render as rounded two-tone powerline pills (`` … ``):

```json
{
  "sections": {
    "a": [{ "type": "mode", "accent": "bright-yellow", "icon": "󰘧" }],
    "b": [{ "type": "git_branch", "accent": "bright-cyan", "icon": "" }],
    "z": [{ "type": "clock", "accent": "bright-magenta", "icon": "󱑂", "iconSide": "right" }]
  }
}
```

`iconSide` defaults to `"left"`. Set it to `"right"` for right-pinned sections so the icon badge and cap colors mirror: the body sits on the left and the accent badge on the right.

When `accent` is set, components without output (e.g. `git_branch` outside a repo) are omitted entirely without leaving dangling caps.

Empty output (e.g. `git_branch` outside a repo) is removed before joining, so separators never dangle.

## Extension layer

Other extensions can contribute named components without this package importing them. A section references one by `type`, and the top-level `extensions` array enables it — names missing from the array render nothing:

```json
{
  "extensions": ["mode-guard"],
  "sections": {
    "a": [{ "type": "mode-guard", "fg": "green", "bold": true }]
  }
}
```

The protocol runs over pi's shared event bus, so neither side imports the other:

- Providers emit `pi.events.emit("statusline:values", { name, text })` whenever a value changes (and once with the current snapshot on `session_start`).
- This package emits `pi.events.emit("statusline:request", { names })` whenever it (re)installs the footer; providers answer by re-emitting their current values.
- Payloads are `{ name: string, text: string }`; unknown shapes are ignored. Updates re-render the footer.

`pi-guard` provides `mode-guard` (current policy mode, uppercased) and `budgets` (`12,500 used, 87,500 remaining`, empty without a cap).
