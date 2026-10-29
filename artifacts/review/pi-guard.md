# pi-guard Review

## Public Seams

- `config.ts:4-44` — `GuardConfig`, `loadGuardConfig`, `saveGuardConfig`, `getGuardConfigPath`.
- `rules.ts:5-181` — `PersistenceScope`, `DecisionEffect`, `resolveCanonicalPath`, `isSubpath`, `PathTrustVerdict`, `checkPathTrust`, `persistDecision`.
- `context.ts:1-178` — `ContextBreakdown*`, `calculateContextBreakdown`, `formatContextBreakdown`.
- `index.ts:191` — default extension entrypoint.

## Robustness Issues

- `index.ts:383-393` — `tool_result` assumes `event.content` is an array.
- `index.ts:491-492` — `/context` assumes `getBranch()` returns an array.
- `rules.ts:55-67` — `isSubpath` resolves roots against `process.cwd()`, not necessarily workspace.
- `rules.ts:116-132` — cached decision subpath precedence depends on insertion/order.
- `index.ts:196-381` — async `tool_call` handler errors propagate from prompts/persistence.
- `config.ts:44-55` — `saveGuardConfig` is non-atomic for concurrent sessions.
- `index.ts:55,61` — module-global `sessionDecisions`, `sessionGrants`, `eventSink` are not instance-safe.

## Overengineering

- `rules.ts:8-50` — symlink ancestor-walking canonical path resolver.
- `context.ts:42-154` — detailed character/token accounting.
- `index.ts:146-189` — approval/mode wrapper indirection.