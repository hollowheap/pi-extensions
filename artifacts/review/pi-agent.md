# Review — pi-agent (V01)

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

- `index.ts:13` — `ACTIVE_AGENT_TYPE` constant (`"hollowheap.agent"`).
- `index.ts:25-27,29-32` — `AgentExtensionDeps` + `createAgentExtension(deps)` factory.
- `agents.ts:5-32` — `AgentConfig`, `AgentDiscoveryResult`, `DiscoverAgentsOptions`, `AgentScope`, `discoverAgents`.
- `model.ts:1` — `formatModelId(model)` normalization helper.
- `popup.ts:4-7,9` — `ForkInfo` + `showAgentSwitchPopup(agent, ctx, forkInfo)`.

### Robustness Issues

- Resolution (2026-11-01): Fork results are checked via `forkStarted`; post-fork failures no longer double-apply.
- Resolution (2026-11-01): Persisted-name restoration only clears on an explicit `null`.
- Resolution (2026-11-01): Model matching avoids the unsafe cast and does not notify when `getAll` is unavailable.
- Resolution (2026-11-01): Empty `agent.tools` arrays no longer disable all tools.
- Resolution (2026-11-01): Completion context is refreshed from `before_agent_start` before each run.
- Resolution (2026-11-01): Project-agent discovery resolves the starting cwd and guards directory stats.
- Resolution (2026-11-01): Per-file discovery failures are reported as diagnostics.
- Resolution (2026-11-01): Popup width calculation handles an empty content array.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `index.ts:25-32` + `:39-56` — `AgentExtensionDeps` + duplicate `resolveAgents`/`resolveAgentsWithDiagnostics` wrappers. | R43 | **Overengineered.** R43 requires `/agent` discovery and switching, not dependency injection. `getAgentDir` exists only for tests, and both wrappers call the same `discoverAgents`; one call site would do. |
| `model.ts` — standalone module for a 15-line normalizer. | R43 | **Overengineered.** R43 needs model matching, so `formatModelId` is required behavior. A separate module is not: it has one consumer (`index.ts:83`) and no seam of its own. |
| `agents.ts:5` — `AgentScope`/`scope` option. | R43 | **Overengineered.** R43 requires discovery from both user and project scopes. The `scope` filter is never passed by a caller; `discoverAgents` defaults to `"both"`, so the option only exists for tests. |

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
