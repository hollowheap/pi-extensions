# Review — pi-guard (V05)

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

- `config.ts:4-44` — `GuardConfig`, `loadGuardConfig`, `saveGuardConfig`, `getGuardConfigPath`.
- `rules.ts:5-181` — `PersistenceScope`, `DecisionEffect`, `resolveCanonicalPath`, `isSubpath`, `PathTrustVerdict`, `checkPathTrust`, `persistDecision`.
- `context.ts:1-178` — `ContextBreakdown*`, `calculateContextBreakdown`, `formatContextBreakdown`.
- `index.ts:191` — default extension entrypoint.

### Robustness Issues

- Resolution (2026-11-01): `tool_result` ignores non-array content instead of throwing.
- Resolution (2026-11-01): `/context` treats a non-array `getBranch()` result as empty.
- Resolution (2026-11-01): `isSubpath` accepts a base root; trusted roots resolve against the workspace.
- Resolution (2026-11-01): Cached subpath decisions choose the most specific path, with stricter effects on ties.
- Resolution (2026-11-01): `tool_call` wraps its async handler and fails closed with a reason on unexpected errors.
- Resolution (2026-11-01): `saveGuardConfig` writes a temp file and atomically renames it.
- Resolution (2026-11-01): Session decisions, grants, recent targets, event sink, and last owner now live in a per-extension runtime object.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `rules.ts:8-50` — symlink ancestor-walking canonical path resolver. | R38, D109 | **Required, not overengineering.** R38 requires out-of-workspace access to be gated by trusted roots; D109 defines the trusted-root scheme. Resolving symlinks and non-existent children is how the guard prevents an in-workspace symlink from reaching an untrusted path. |
| `context.ts:42-154` — detailed character/token accounting. | R37, D108 | **Required, not overengineering.** R37/D108 require `/context` to break usage down by thinking, output, input, tool input/output, system prompt, and skills. The accounting is the feature. |
| `index.ts:146-189` — approval/mode wrapper indirection. | R09, R10, R29, D12 | **Required, not overengineering.** R09/R10 assign mode and permission decisions to core/guard, and R29 requires prompt serialization. `requestApproval`/`withPromptLock` are the guard-side adapters for those requirements. |

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
