# pi-modes

Approval modes for the Pi coding agent with `/mode` and `alt+m`.

## Modes

| mode | read | search | edit | shell |
|---|---|---|---|---|
| `manual` (default) | allow | allow | ask | ask |
| `edit` | allow | allow | allow | ask |
| `plan` | allow | allow | deny | ask |
| `auto` | allow | allow | allow | allow |

`plan` still asks for edits to `artifacts/plan.md` and `artifacts/specs.md` and
denies other edits. Entering `auto` shows a warning notice.

The legacy names `ask` and `autopilot` resolve to `manual` and `auto`, so
persisted sessions and agent frontmatter keep working.

## Commands

- `/mode` — fuzzy picker in the TUI, mode list otherwise.
- `/mode <name>` — switch to a mode.
- `alt+m` — cycle `manual` → `edit` → `plan` → `manual`. `auto` is
  available through `/mode auto` or the picker, not the shortcut.

The active mode is persisted as the `hollowheap.core.mode` session entry and
restored on `session_start` and `session_tree`. A missing restored mode falls
back to `manual` with a diagnostic, and entry gates re-run on restore.

## Custom modes

`<agentDir>/modes.json` adds layers. Config layers are replaced on every
session start; built-in and package layers persist.

```json
{
  "modes": {
    "readonly": {
      "defaults": {
        "read": "allow",
        "search": "allow",
        "edit": "deny",
        "shell": "deny"
      },
      "overrides": [{ "tag": "edit", "pattern": "docs/**", "effect": "ask" }]
    }
  }
}
```

`defaults` must cover all five tags; overrides accept only `ask` or `deny`.
Names that collide with a registered layer are rejected with a warning.

`pi-guard` enforces the active mode and publishes the statusline badge.
`pi-modes` emits `mode:changed` and updates the session snapshot on every
switch.

## Try it

```bash
pi -e ./extensions/pi-modes
```

## Install

```bash
pi install npm:@hollowheap/pi-modes
```
