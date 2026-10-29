# pi-agent Review

## Public Seams

- `index.ts:13` — `ACTIVE_AGENT_TYPE` constant (`"hollowheap.agent"`).
- `index.ts:25-27,29-32` — `AgentExtensionDeps` + `createAgentExtension(deps)` factory.
- `agents.ts:5-32` — `AgentConfig`, `AgentDiscoveryResult`, `DiscoverAgentsOptions`, `AgentScope`, `discoverAgents`.
- `model.ts:1` — `formatModelId(model)` normalization helper.
- `popup.ts:4-7,9` — `ForkInfo` + `showAgentSwitchPopup(agent, ctx, forkInfo)`.

## Robustness Issues

- `index.ts:205` — `result.cancelled` accessed without null guard; if `ctx.fork` resolves `undefined`, throws.
- `index.ts:227-229` — persisted-name loop overwrites on every custom entry; later entry with `data.name === undefined` clears prior valid agent.
- `index.ts:171-210` — fork path: `forked` may be set true before `applyAgent`/popup complete; on throw, falls through to in-place switch and can double-apply.
- `index.ts:79-94` — model match uses loose `find` with `as never` cast; if `agent.model` present but registry lacks `getAll`, falsely notifies "not found".
- `index.ts:122-131` — empty `agent.tools` array is truthy, so `setActiveTools([])` disables all tools.
- `index.ts:288-289` — `getArgumentCompletions` relies on closure `lastCwd`/`lastTrusted`, which can be stale.
- `agents.ts:144` — `statSync(candidate).isDirectory()` unguarded (throws on permission/access errors).
- `agents.ts:74-136` — per-file catch silently swallows errors with no diagnostic.
- `popup.ts:55` — `Math.max(...contentLines.map(...))` assumes non-empty array; would be `-Infinity` if empty.

## Overengineering

- `index.ts:25-32` + `:39-56` — `AgentExtensionDeps` + duplicate `resolveAgents`/`resolveAgentsWithDiagnostics` wrappers.
- `model.ts` — standalone module for a 15-line normalizer.
- `agents.ts:5` — `AgentScope`/`scope` option is generalization with no external consumer beyond tests.