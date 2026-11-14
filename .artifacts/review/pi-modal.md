# Review — pi-modal (V08)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`


## Requirements Review

N/A — package robustness review; traceability is recorded in the Code Review findings.

## Design Review

N/A — package robustness review; see `artifacts/architecture.md`.

## Specification Review

N/A — package robustness review; verify commands are recorded under Code Review.

## Plan Review

N/A — package robustness review; tasks remain in `artifacts/plan.md`.

## Code Review

### Public Seams

- `index.ts:6` — `ModalEditor` class; `:7` re-exports all of `keymap.ts`.
- `editor.ts:21` — `ModalEditor extends CustomEditor`; public accessors `getPromptChar` (:61), `getMode`/`setMode` (:65/:69), `getSelectionAnchor` (:78), `getYankedText` (:82), `getClipboardError` (:86), `getSelection` (:90), `getKeymaps` (:99).
- `keymap.ts:4` — `EditorMode`; `:6` `ModalKeymapConfig`; `:12` `BorderStyle`; `:14` `ModalConfig`.
- `keymap.ts:22/41/57` — `DEFAULT_NORMAL_KEYS` / `DEFAULT_VISUAL_KEYS` / `DEFAULT_INSERT_KEYS`.
- `keymap.ts:105` — `loadModalConfig(agentDir, onDiagnostic?)`; `:183` — `resolveEffectiveKeymaps(userConfig)`.

### Robustness Issues

- `editor.ts:184-199` — `deleteSelection` reaches into `CustomEditor` private `state`/`preferredVisualCol` via `this as unknown as`; breaks across host versions.
- `editor.ts:296-326` — search mode collects query but movement is a no-op `super.handleInput("\\x1b[G")` (:310); no cursor jump.
- `editor.ts:328-363` — `:%s/old/new/g` command mode only stores `searchQuery`; performs no substitution.
- `editor.ts:414` — render casts `scrollOffset` via `as unknown as { scrollOffset?: number }`; assumes host internal field name.
- `keymap.ts:105-118` — malformed config swallowed with no diagnostic; `initialMode` not validated (:96).
- `editor.ts:138-149` — clipboard write swallows all errors and assumes `tui.terminal.write`.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `editor.ts:502-587` — 85-line ANSI state machine for selection highlighting. | R46, D118 | **Required, not overengineering.** R46/D118 require visual selection with a distinct highlight and yank/cut/change behavior. Rendering styled selection inside the editor is the required mechanism. |
| `editor.ts:296-363` — non-functional search/substitution scaffolding. | R53, D125 | **Required behavior, incomplete implementation.** R53/D125 explicitly require `/` search with `n`/`N` and `:%s/old/new/g`. The problem is that movement/substitution is a no-op, not that the feature is unrequested. |
| `editor.ts:404-499` — render mixes prompt prefix, mode badge, border, and selection highlighting. | R40, R46, R47, D112, D118, D119 | **Required, not overengineering.** R40/R47 and D119 require the prompt character, mode badge, and rounded border; R46/D118 require selection highlighting. One render override is how the editor composes them. |

### Resolution (2026-10-30)

- The badge shows `BASH` while the prompt text starts with `!`, instead of `NORMAL`/`INSERT`/`VISUAL`.
- Visual selection is highlighted after prompt decoration; a selection starting at column zero includes the prompt marker and text.
- Selection deletion repositions through public editor input rather than host-private `state`/`preferredVisualCol`.
- `/` search now moves to the match; `n`/`N` repeat forward/backward with wraparound.
- `:%s/old/new/g` performs the substitution and preserves cursor position where possible.
- Selection rendering derives scroll position from the visible content height instead of host-private `scrollOffset`.
- `modal.json` validates malformed roots, initial modes, prompt chars, border styles, and keymap entries, reporting diagnostics through `ctx.ui.notify`.
- Clipboard writes fall back to stdout and expose the last write error; yank still stores the selection.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
