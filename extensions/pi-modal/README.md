# pi-modal

pi-modal Pi coding agent extension.

## Try it

```bash
pi -e ./extensions/pi-modal
```

## UI settings

`/ui settings` opens Appearance, Output, and Tools tabs. Use Tab and Shift+Tab
to switch tabs, type to search the active tab, and press Enter to cycle a value.
`/ui status` shows the current settings.

**Thinking verbosity** in Output uses Pi's collapsed thinking at Low, a
one-line preview at Medium, and Pi's expanded thinking at High.

**Tool verbosity** in Tools shows only the tool and arguments at Low.
Medium uses Pi's collapsed output and High uses its expanded output.
Codemode results use a fixed collapsed preview at Medium and High.
Changes take effect immediately and save to `<agentDir>/tui.json`.

## Tool box

With `panel.enabled` in `<agentDir>/tui.json`, tool calls render in a
self-contained box. The border and accent stripe use the tool state color:
`toolPendingBg` while running, `toolSuccessBg` when settled, and `toolErrorBg`
on failure. If a theme defines those tokens with ANSI 8 base colors, the
brighter ANSI 16 variant supplies the foreground border color. Inherited
background fills from host renderers are stripped so the panel owns its
background. **Panel style** combines border choices,
themed boxes such as `surface`, `card`, and `contrast`, and the borderless
`background` style. Themed boxes use the common border style and paint the
full frame. Panels use Pi’s output padding and the editor uses Pi’s editor padding.

## Indicators

`loadingIndicator` also styles host-owned loaders for shell execution and
context compaction, including the `colored` setting. Use `host` to leave those
loaders on Pi's default spinner.
