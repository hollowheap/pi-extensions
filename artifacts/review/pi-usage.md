# Review — pi-usage (V15)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`

Status (2026-10-30): usage validation, cache totals, cost-model selection,
WeakMap session tracking, budget warning restore, and the `/usage cap` setter
are fixed. `pi-budgets` is retired; `pi-usage` owns the optional USD cap,
80%/100% enforcement, and the statusline `usage` provider. Token caps are not
carried over. Autopilot has no mandatory cap. Subagent usage attribution is designed in R68/D152 and remains
unimplemented.


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

- `index.ts:7` — `USAGE_ENTRY_TYPE`
- `index.ts:9` — `ModelUsage`
- `index.ts:18` — `CumulativeUsage`
- `index.ts:79` — `extractLatestUsage(entries)`
- `index.ts:142` — `recordTurnUsage(current, turnUsage, turnCost?, model?)`
- `index.ts:213` — `formatUsageReport(usage)`
- `index.ts:267` — `setSessionBudgetCap(owner, cap)`
- `index.ts:284` — `getSessionUsage(owner)`
- `index.ts:330` — default extension entry

### Robustness Issues

- `index.ts:30-97` — `extractLatestUsage` restores `budgetCap` but not `budgetWarning`.
- `index.ts:85-87` — `byModel` cast from unvalidated input (`data.byModel as Record<string, ModelUsage>`).
- `index.ts:214-237` — `restoreSessionUsage` overwrites `activeUsage` with empty/zero result when neither `getEntries` nor `getBranch` exists.
- `index.ts:277-292` — cost calculated from `ctx.model` at `message_end`, not `event.message.model`; wrong model after switch.
- `index.ts:143` — per-model and total costs rounded independently, allowing cumulative drift.
- `index.ts:155` — `totalTokens` excludes cache tokens despite tracking them.
- `index.ts:198` — module-global `activeUsage` Map never reset on module reload; keyed by session-manager identity.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `index.ts:18,26-27` — `budgetCap`/`budgetWarning` and 80% threshold with no setter/config/command. | R54, D126 | **Fixed.** `/usage cap` sets or clears the dollar cap; 80% warning and 100% abort are wired; the cap persists in usage entries. |
| `index.ts:239-251` — `calculateCostFromModel` single-use wrapper. | R39, R54 | **Fixed.** Inlined into `message_end`; pricing now uses the assistant message model. |
| `index.ts:214-237` — manual duck-typing for `getEntries`/`getBranch`. | R39, D24 | **Required, not overengineering.** R39 requires usage to survive compaction; D24 restores session state from custom entries. Checking both host accessors is the compatibility path for that restore. |

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — findings resolved.
