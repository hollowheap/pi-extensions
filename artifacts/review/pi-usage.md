# pi-usage Review

## Public Seams

- `index.ts:7` — `USAGE_ENTRY_TYPE`
- `index.ts:9` — `ModelUsage`
- `index.ts:18` — `CumulativeUsage`
- `index.ts:30` — `extractLatestUsage(entries)`
- `index.ts:99` — `recordTurnUsage(current, turnUsage, turnCost?, model?)`
- `index.ts:165` — `formatUsageReport(usage)`
- `index.ts:200` — `getSessionUsage(owner)`
- `index.ts:253` — default extension entry

## Robustness Issues

- `index.ts:30-97` — `extractLatestUsage` restores `budgetCap` but not `budgetWarning`.
- `index.ts:85-87` — `byModel` cast from unvalidated input (`data.byModel as Record<string, ModelUsage>`).
- `index.ts:214-237` — `restoreSessionUsage` overwrites `activeUsage` with empty/zero result when neither `getEntries` nor `getBranch` exists.
- `index.ts:277-292` — cost calculated from `ctx.model` at `message_end`, not `event.message.model`; wrong model after switch.
- `index.ts:143` — per-model and total costs rounded independently, allowing cumulative drift.
- `index.ts:155` — `totalTokens` excludes cache tokens despite tracking them.
- `index.ts:198` — module-global `activeUsage` Map never reset on module reload; keyed by session-manager identity.

## Overengineering

- `index.ts:18,26-27` — `budgetCap`/`budgetWarning` and 80% threshold have no setter, config, or command surface; effectively dead complexity.
- `index.ts:239-251` — `calculateCostFromModel` is single-use wrapper.
- `index.ts:214-237` — manual duck-typing for `getEntries`/`getBranch` adds compatibility branches.