# pi-statusline

Lualine-style configurable statusline footer for the Pi coding agent. Define `sections.a` through `sections.z`, each a list of `{ "type", ...options }` components. Sections `a`–`m` pin to the left, `n`–`z` pin to the right.

## Try it

```bash
pi -e ./extensions/pi-statusline
```

Do not enable another footer extension at the same time; the last one to load wins.

## Configure

Create `<agentDir>/statusline.json` (`~/.pi/agent/statusline.json`). Missing file falls back to the default below; problems are reported once per session and fall back per-field.

```json
{
  "options": {
    "componentSeparator": " ",
    "sectionSeparator": "  "
  },
  "sections": {
    "a": [{ "type": "mode-guard" }],
    "b": [{ "type": "git_branch" }, { "type": "cwd" }],
    "y": [{ "type": "tokens" }, { "type": "cost" }, { "type": "usage" }],
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
| `cwd` | working directory, truncated to the repository name when inside a git repo | `depth` (last N segments outside git repo), `homeAsTilde` (default `true`) |
| `git_branch` | current branch, hidden outside a repo | `icon` |
| `git_diff` | `+a ~m -r ?u` file counts, refreshed in background | `addedIcon`, `modifiedIcon`, `removedIcon`, `untrackedIcon` |
| `model` | active model id | `shorten` (strip `provider/` prefix, default `true`) |
| `tokens` | session `↑input ↓output` | `showInput`, `showOutput` |
| `cost` | session spend | `decimals` (default `3`), `prefix` (default `"$"`) |
| `context` | context window usage percent | — |
| `usage-pct` | Share of the session dollar cap spent, including available subagent costs | — |
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

## Click actions

Map a segment name to a command in `statusline.json`:

```json
{
  "clickActions": {
    "model": "echo model",
    "git_branch": "git log -1 --oneline"
  }
}
```

Use `/statusline click <segment>` to run the mapped command. Actions beginning with `/` are sent as Pi slash commands; other actions are split into an executable and arguments and run without a shell. Output and failures are shown as notifications.

Defaults: `mode` → `/mode`, `model` → `/model`, and both `usage` and `usage-pct` → `/usage`. Configure `clickActions` to override them.

Mouse input is owned by Pi's main-screen renderer, so this package exposes click actions through the `/statusline click` command rather than raw footer mouse events.

## Settings panel

`/statusline settings` opens a TUI settings list for the component separator, section separator, and git refresh interval. Changes apply immediately and are saved to `statusline.json`; unrelated sections, colors, and click actions are preserved. Non-TUI modes should edit `statusline.json` directly.

`/statusline working default|pulse|compact|hidden` sets the streaming indicator for the current session. `/statusline thinking <label>` overrides the hidden-thinking label; use `default` to restore it.

## Theme picker

`/theme` lists built-in and discovered themes. It previews the highlighted theme immediately; Enter keeps it, and Escape restores the previous theme.

## Extension layer

Other extensions contribute named components by registering a provider. A section references the provider by `type`; no allowlist or `pi-statusline` code change is needed:

```json
{
  "sections": {
    "a": [{ "type": "mode-guard", "fg": "green", "bold": true }]
  }
}
```

```ts
import { registerStatuslineProvider } from "@hollowheap/core/statusline";

const dispose = registerStatuslineProvider({
  name: "my-component",
  render: (spec, ctx) => ctx.busy ? "BUSY" : "READY",
});
```

`render(spec, ctx)` must return plain text. `pi-statusline` owns styling, pill caps, truncation, and placement. Providers may also implement `refresh(spec, ctx)` for cached async values and `intervalMs(spec)` to request a refresh cadence. The disposer removes the registration.

The legacy event bus remains supported for existing providers:

- Providers emit `pi.events.emit("statusline:values", { name, text })` whenever a value changes.
- This package emits `pi.events.emit("statusline:request", { names })` when it installs the footer; providers answer by re-emitting current values.
- The first value for a name registers a compatibility provider automatically.

`pi-guard` provides `mode-guard` (current policy mode, uppercased) and `pi-usage` provides `usage` (`$0.05/$5.00`, empty without a cap).

## Script components

The built-in `script` provider runs a configured command without a shell and renders its first output line:

```json
{
  "sections": {
    "b": [
      {
        "type": "script",
        "command": "git rev-parse --short HEAD",
        "intervalMs": 5000,
        "timeoutMs": 1000,
        "maxChars": 40
      }
    ]
  }
}
```

`args` may add an array of arguments; `cwd` overrides the session working directory. Failures and empty output hide the component. Values are cached and refreshed on footer install, turns, tool completion, and `intervalMs`.

Use `{ "type": "usage-pct" }` in a section for a whole-number percentage,
such as `42%`. The component reads the active branch's persisted
`pi-usage` data, shows spend above the cap, and stays hidden when the
branch has no cap.
