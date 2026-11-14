# V63 — session-enrichment-and-dashboard r2 (robust)

Scope: Uncommitted workspace changes (session snapshots, `pi-dashboard` sections/overlay, `pi-statusline` git cwd truncation, `packages/pi-acp`, `packages/policy`, `extensions/pi-decide`) and commit `117285e` (`pi-question` / `pi-todos` codemode migration).
Mode: robust (re-review via `code-reviewer`, followed by final Medium/Low fix pass).

## Inputs
- Review: `code-reviewer` (`c48dcb51-5160-4953-befd-3afde5e19ccf`) re-inspection of `V62` fixes and full diff relative to `HEAD` (`117285e`).
- Checks: `npx tsc -p packages/pi-acp`, `npm run typecheck`, `npm run lint`, `npm test`, `scripts/artifacts.sh check`, `scripts/artifacts.sh verify-links`.

## Prior `V62` Fixes Verified
- `packages/policy/src/targets.ts:20-25` & `targets.test.ts:17-20`: `codemode`, `question`, `todo`, `todos` mapped to `"read"`, keeping nested `tools.*` gated via `tool_call` hooks while enabling `plan` mode flows.
- `packages/pi-acp/src/pi-rpc.ts` & `pi-rpc.test.ts`: blocking `rbw` lookup removed from `ensureEnvironment`; PATH setup and env merge remain non-blocking.
- `packages/pi-acp/src/adapter.ts:862-867`: `[live.currentModel]` fallback handles empty `availableModels`.
- `extensions/pi-decide/src/decide.ts` & `index.ts`: `persistDecideStats` writes `hollowheap.decide` on `agent_end` / `session_compact` without altering S182 per-call `USAGE_ENTRY_TYPE` ledger counts.

## Follow-up Fixes Applied After r2 Review
- `packages/pi-acp/src/extension/index.ts:16-196`: Replaced local `readPathArg`/`readCommandArg` helpers with shared `@hollowheap/policy/targets` imports (`TOOL_TAGS`, `readCommandArg`, `readToolTarget`), fixing non-path target extraction for `web_fetch`, `web_search`, `decide`, `codemode`, `question`, and `todo`.
- `extensions/pi-decide/src/index.ts:45-59`: Added optional-chaining guard `ctx?.sessionManager` in `agent_end` and `session_compact` handlers.
- `packages/policy/src/targets.test.ts:34`: Added assertion verifying `readToolTarget("todos", { action: "list" })`.

## Verification
- Verified after final edits: `npx tsc -p packages/pi-acp && npm run typecheck && npm run lint && npm test && scripts/artifacts.sh check && scripts/artifacts.sh verify-links`.
