# pi-modal

pi-modal Pi coding agent extension.

## Try it

```bash
pi -e ./extensions/pi-modal
```

## Expand tool output

`/expand [on|off|toggle]` toggles tool output expansion. Expanded mode reveals
the full codemode script preview, full nested call arguments (including
`web_search`, `web_fetch`, and `lang`), and full script output. This is the same
state as the `ctrl+o` shortcut, exposed as a command for discoverability.

`ctrl+shift+o` opens the last codemode script on its own in an editor dialog,
without expanding the rest of the tool output.

## Tool box

With `toolBox.enabled` in `<agentDir>/tui.json`, every tool call renders in a
self-contained box. The border and accent stripe use the tool state color:
`toolPendingBg` while running, `toolSuccessBg` when settled, and `toolErrorBg`
on failure. If a theme defines those tokens with ANSI 8 base colors, the
brighter ANSI 16 variant supplies the foreground border color. Inherited
background fills from host renderers are stripped, so the box stays
background-free and only the border carries the state color.

## Indicators

`loadingIndicator` also styles host-owned loaders for shell execution and
context compaction, including the `colored` setting. Use `host` to leave those
loaders on Pi's default spinner.
