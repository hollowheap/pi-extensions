# pi-modal

pi-modal Pi coding agent extension.

## Try it

```bash
pi -e ./extensions/pi-modal
```

## Install

```bash
pi install npm:@hollowheap/pi-modal
```

## Expand tool output

`/expand [on|off|toggle]` toggles tool output expansion. Expanded mode reveals
the full codemode script preview, full nested call arguments (including
`web_search`, `web_fetch`, and `lang`), and full script output. This is the same
state as the `ctrl+o` shortcut, exposed as a command for discoverability.

`ctrl+shift+o` opens the last codemode script on its own in an editor dialog,
without expanding the rest of the tool output.
