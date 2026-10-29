# pi-autopilot Review

## Public Seams

- `index.ts:4` — `AUTOPILOT_MODE: ModeLayer` (exported; name, description, defaults, `onEnter`).
- `index.ts:21` — default extension factory registers the layer.
- Core seams: `packages/core/src/modes.ts:69` `registerMode`, `packages/core/src/types.ts:23` `ModeLayer`, `packages/core/src/modes.ts:261` `evaluate`.

## Robustness Issues

- Registration idempotency delegated to core (`modes.ts:73-77`); duplicate `autopilot` returns `false` and keeps first.
- Safety not self-contained: autopilot allows `shell: "allow"` and relies on pi-guard's bash safety list plus project deny rules; running autopilot without pi-budgets permits un-capped entry.
- `AUTOPILOT_MODE` is an exported mutable object, not frozen (`index.ts:4`).

## Overengineering

- Package is essentially one 16-line mode layer (`index.ts:4-23`); modular packaging intentional for optional install, but abstraction surface (`ModeLayer` + `onEnter` notice) larger than behavior.