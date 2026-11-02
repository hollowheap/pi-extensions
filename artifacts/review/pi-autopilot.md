# Review — pi-autopilot (V02)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`

Status (2026-10-30): `pi-budgets` is retired. Autopilot has no mandatory cap;
`pi-usage` supplies optional caps. The layer is frozen and registered only.


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

- `index.ts:4` — `AUTOPILOT_MODE: ModeLayer` (exported; name, description, defaults, `onEnter`).
- `index.ts:21` — default extension factory registers the layer.
- Core seams: `packages/core/src/modes.ts:69` `registerMode`, `packages/core/src/types.ts:23` `ModeLayer`, `packages/core/src/modes.ts:261` `evaluate`.

### Robustness Issues

- Registration idempotency delegated to core (`modes.ts:73-77`); duplicate `autopilot` returns `false` and keeps first.
- Cap is optional by design: autopilot can enter without `pi-usage`; project deny rules and `pi-guard` shell safety still apply.
- `AUTOPILOT_MODE` is an exported mutable object, not frozen (`index.ts:4`).

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `index.ts:4-23` — one 16-line mode layer; abstraction surface (`ModeLayer` + `onEnter` notice) larger than behavior. | R22, R09, D07, D13 | **Required, not overengineering.** R22 explicitly calls for focused packages, and D13 says `pi-autopilot` only registers the layer. `ModeLayer` is the core mode abstraction required by R09/D07. The `onEnter` notice is small UX, not a separate abstraction. |

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
