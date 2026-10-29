# pi-modal Review

## Public Seams

- `index.ts:6` — `ModalEditor` class; `:7` re-exports all of `keymap.ts`.
- `editor.ts:21` — `ModalEditor extends CustomEditor`; public accessors `getPromptChar` (:59), `getMode`/`setMode` (:63/:67), `getSelectionAnchor` (:76), `getYankedText` (:80), `getSelection` (:84), `getKeymaps` (:93).
- `keymap.ts:4` — `EditorMode`; `:6` `ModalKeymapConfig`; `:12` `BorderStyle`; `:14` `ModalConfig`.
- `keymap.ts:22/41/57` — `DEFAULT_NORMAL_KEYS` / `DEFAULT_VISUAL_KEYS` / `DEFAULT_INSERT_KEYS`.
- `keymap.ts:59` — `loadModalConfig(agentDir)`; `:120` — `resolveEffectiveKeymaps(userConfig)`.

## Robustness Issues

- `editor.ts:184-199` — `deleteSelection` reaches into `CustomEditor` private `state`/`preferredVisualCol` via `this as unknown as`; breaks across host versions.
- `editor.ts:296-326` — search mode collects query but movement is a no-op `super.handleInput("\\x1b[G")` (:310); no cursor jump.
- `editor.ts:328-363` — `:%s/old/new/g` command mode only stores `searchQuery`; performs no substitution.
- `editor.ts:414` — render casts `scrollOffset` via `as unknown as { scrollOffset?: number }`; assumes host internal field name.
- `keymap.ts:105-118` — malformed config swallowed with no diagnostic; `initialMode` not validated (:96).
- `editor.ts:138-149` — clipboard write swallows all errors and assumes `tui.terminal.write`.

## Overengineering

- `editor.ts:502-587` — 85-line hand-rolled ANSI state machine for selection highlighting.
- `editor.ts:296-363` — non-functional search/substitution scaffolding shipped as features.
- `editor.ts:404-499` — render mixes prompt prefix, mode badge, border, and selection highlighting in one override.