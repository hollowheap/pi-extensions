# Review — session-definitions (V18)

## Scope

- Requirements: R79
- Decisions: D173
- Specs: S170
- Feature commit: `2e31bdb`; review head: `5834dce`; fixes: `99cd6b5`, `a57b263`
- Mode: robust, one slice (`define`, persist, restore, start/resume)
- Reviewer: one read-only code-reviewer; the primary session reproduced findings and applied fixes.

## Requirements Review

N/A — robustness review; traceability is recorded under Code Review.

## Design Review

N/A — robustness review; the seam is recorded in `artifacts/architecture.md` and D173.

## Specification Review

N/A — robustness review; verification is recorded under Code Review.

## Plan Review

N/A — robustness review; no task changes.

## Code Review

### Findings

#### 1. Medium, fixed — `define` results rendered as an empty child row

- Current: `extensions/pi-subagents/src/tool.ts:305-310` handles `details.defined` before the child-state branches.
- Gap: before the fix, `renderResult` had no definition branch. `{ defined, source }` fell through to the child result renderer with empty `id`, `status`, and `agent`.
- Failure impact: every successful `define` displayed an empty `○ @ []` row. The tool result text stayed correct, so this was user-visible correctness, not state loss.
- Default check: `extensions/pi-subagents/src/tool.test.ts:239` renders a definition result and asserts `session agent reviewer`.
- Confidence: High.

#### 2. Medium, fixed — branch restore was not fail-closed

- Current: `extensions/pi-subagents/src/index.ts:58-67` catches branch-read failures and clears the in-memory map. `extensions/pi-subagents/src/definitions.ts:43-48` returns an empty map for non-array input.
- Gap: before the fix, `getBranch()` failures propagated out of `session_start`/`session_tree`, and a non-array value threw inside `for...of`. The previous branch's definitions stayed active.
- Failure impact: a failed branch switch could leave stale session agents startable from the wrong branch. An exception could also skip the `session_start` state emission.
- Default check: `extensions/pi-subagents/src/index.session.test.ts:162` covers a throwing and a non-array branch; `extensions/pi-subagents/src/definitions.test.ts:66` covers non-array helper input.
- Confidence: High.

#### 3. Low, open — direct `define` calls assume string-shaped fields

- Current: `extensions/pi-subagents/src/tool.ts:422-433` calls `.trim()` and `.map()` before validating runtime types.
- Gap: TypeBox protects normal model calls. A direct caller can pass non-strings and receive a generic caught error.
- Failure impact: poor diagnostics only; no state is written before the throw.
- Default check: `extensions/pi-subagents/src/tool.test.ts:298` covers missing fields through the tool schema path.
- Confidence: Medium.

#### 4. Low, fixed — definitions now have configurable bounds and deletion

- Current: `extensions/pi-subagents/src/config.ts:13-22` declares `maxSessionAgents` and `maxSessionAgentBytes`; `extensions/pi-subagents/src/tool.ts:450-465` enforces them for new definitions; `extensions/pi-subagents/src/tool.ts:408-417` implements `delete`.
- Gap: before the fix, repeated large definitions grew the session JSONL and restore scan with no delete or eviction action.
- Failure impact: long sessions could accumulate stale definitions and slower branch restores. Markdown agent files still have the same unbounded prompt risk.
- Default check: R80/S171 and `config.test.ts`, `definitions.test.ts`, `tool.test.ts`, and `index.session.test.ts` cover bounds, tombstones, and file-agent refusal.
- Confidence: High.

### Failure Modes

- A failed `getBranch()` read now clears definitions instead of keeping definitions from the previous branch.
- `appendEntry` runs before the map update. If it throws, neither the session nor memory changes; the tool returns an error.
- A successful append followed by an in-memory failure would desync persisted and live state until the next restore. OOM is the only realistic trigger; no transaction is added.
- Branch navigation removes definitions absent from the new branch. Definitions return when navigating back.
- Re-defining a name appends a new entry and the latest definition wins.
- A session definition shadows a file agent for both `start` and `resume`.
- Resume of a session agent whose definition is absent from the current branch fails with `unknown agent`.
- Define remains available in untrusted projects; `start` keeps the trust and permission gates.

### Seams

- `definitionsFromEntries(entries: unknown)` is the pure branch parser; non-array input returns an empty map.
- `createSubagentTool({ getSessionAgents, defineSessionAgent })` is the session-agent resolution and persistence seam.
- `session_start` and `session_tree` rebuild the map; `session_shutdown` clears it.
- `PASSTHROUGH_ACTIONS` in `packages/policy/src/targets.ts` includes `define`; `start` keeps the existing gate.

### Rejected Defaults

- `define` passthrough is intended: it starts no child, and D173/S170 keep `start` gated.
- Case-sensitive names match existing file-agent discovery.
- Latest-wins duplicate definitions are intentional and tested.
- Isolated-workspace loss on resume is pre-existing resume behavior, not introduced by definitions.
- An append/map transaction is not warranted: append failure leaves both unchanged.

### Open Questions

- Should resume preserve an isolated workspace for a failed session-agent child?

## Verification

```bash
npx vitest run extensions/pi-subagents/src
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
git diff --check
```

- Targeted: 22 files, 174 tests passed.
- Full suite: 112 files, 1013 tests passed (`artifacts/logs/session-definitions-bounds-delete.log`).
- Typecheck passed; lint checked 314 files; `git diff --check` clean.

## Findings

Two medium findings and the deferred bounds finding were fixed. The remaining low finding is outside the normal tool boundary and is not blocking.

## Verdict

Accepted — both blocking findings fixed and verified. No open `Qxx`.
