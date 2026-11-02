# Review — pi-hooks (V06)

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

- Deep imports: `config.ts` (`HookEntry`, `HookConfig`, `LoadHooksOptions`, `loadHooks`) and `hooks.ts` (`HookPayload`, `SessionHookPayload`, `PreVerdict`, `PostHookResult`, `SessionHookResult`, `evaluateCondition`, `matchesTool`, `runPreHook`, `runPostHook`, `runSessionHook`, `interpretPreHook`).
- Config file seam: `loadHooks` merges `<agentDir>/hooks.json` + `<workspaceRoot>/.pi/hooks.json` based on `trusted`.
- Event-handler seams: `session_start`, `tool_call`, `tool_result`.
- Command protocol seam: JSON on stdin and pre-hook decisions.
- Skill discovery seam: gated by `PI_HOOKS_DISCOVER_SKILL=1`.

### Robustness Issues

- Resolution (2026-11-01): `evaluateCondition` regexes now match whitespace, and malformed conditions evaluate false instead of fail-open.
- Resolution (2026-11-01): Non-object tool input is normalized to `{ value }`; object input is passed through without an unsafe cast.
- Resolution (2026-11-01): Post-tool notifications use a guarded warning helper, so a missing UI cannot reject the result handler.
- Resolution (2026-11-01): Pre-tool setup failures now block with a warning; post-tool setup failures warn and leave the result unchanged.
- Resolution (2026-11-01): Chained `previousOutput` is cleared after a failed or outputless hook; only the immediately preceding output is forwarded.
- Resolution (2026-11-01): Cached diagnostics are delivered once per `onDiagnostic` callback, not once globally; the extension reuses a stable callback per session.
- Resolution (2026-11-01): The module-global hooks cache is cleared on session shutdown.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `hooks.ts:37-55` — mini condition language plus `evaluateCondition`. | R61, D133 | **Required, not overengineering.** R61/D133 explicitly require conditionally skipped hooks by tool name or path. The regex bug is a robustness defect, not unrequested complexity. |
| `config.ts:37-42` + `:56-63` — mtime-keyed cache with `reported` flag and per-entry diagnostics. | R08, D05 | **Required behavior, duplicated implementation.** D05 requires mtime-cached JSON config with once-per-change diagnostics, and R08 says consumers use the core primitive. This is a duplicate cache, not an overengineered feature. |
| `hooks.ts:23-35` + `interpretPreHook` — exported types and interpreter expose implementation details. | R15, D35, D37 | **Required, not overengineering.** D35/D37 define the stdin/stdout hook protocol and allow/block verdict. `interpretPreHook` is the interpreter for that protocol; the exported payload types are the test seam for the same contract. |

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
