# V62 — session-enrichment-and-dashboard r1 (needs-fixes)

Scope: Uncommitted workspace changes (session snapshots, `pi-dashboard` sections/overlay, `pi-statusline` git cwd truncation, `packages/pi-acp`, `packages/policy`) and commit `117285e` (`pi-question` / `pi-todos` codemode migration).
Mode: needs-fixes (review via `code-reviewer`).

## Inputs
- Review: `code-reviewer` subagent inspection against `HEAD` (`117285e`).
- Tests & Checks: Full suite, `npx tsc -p packages/pi-acp`, `npm run typecheck`, `npm run lint`.

## Fixed During `/update`
- `extensions/pi-dashboard/src/sections.ts:39`: Replaced nonexistent `/guard` shortcut with `/grants` (`label: "Grants"`).
- `packages/pi-acp/src/adapter.ts:862-867`: Added `[live.currentModel]` fallback when `live.availableModels` is empty in `session/set_config_option`.
- `packages/core/src/snapshot.ts:320-329`: Allowed direct custom entry types when `raw.type !== "custom"` in `extractSessionSummaryFromEntries`.
- `extensions/pi-todos/src/index.ts:457-463`: Guarded `ctx.sessionManager?.getBranch()` with `getEntries()` fallback in `restore`.

## Remaining Findings
1. **High — `packages/policy/src/targets.ts:20-23` (`codemode` / `todo` tags in `plan` mode)**:
   `codemode` and `todo` are tagged `"edit"`, so `plan` mode denies `tools.question` and `tools.todo` invocations routed through `codemode`. Deferred pending explicit policy design decision on codemode sub-call vs outer-call gating.
2. **High — `packages/pi-acp/src/pi-rpc.ts:251-272` (`rbw` `spawnSync` in `ensureEnvironment`)**:
   Synchronously invokes `rbw get --folder dev/keys opencode` (up to 2s timeout) on every `spawnPiRpc`. Preserved untouched as local user workaround; replace with explicit env/resolver for portability.
3. **Medium — `extensions/pi-decide/src/decide.ts:143,205-220` (`hollowheap.decide` persistence)**:
   `restoreDecideStats` reads `DECIDE_STATS_TYPE`, while `recordDecide` updates in-memory `WeakMap` + `DecideSnapshot` only so S182 keeps a single `pi.appendEntry(USAGE_ENTRY_TYPE, ...)` per billed call.
4. **Low — `packages/pi-acp/src/extension/index.ts:21-34` (`BUILTIN_TAGS`)**:
   Local copy of tool tag map duplicates `@hollowheap/policy/targets.js` `TOOL_TAGS`.

## Verification
- Re-run after fixes: `npx tsc -p packages/pi-acp && npm run typecheck && npm run lint && npm test`.
