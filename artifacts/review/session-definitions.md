# Review — session-definitions (V18)

## Scope

- Requirements: R79
- Decisions: D173
- Specs: S170
- Feature commit: `2e31bdb`; review head: `5834dce`; fixes: `99cd6b5`
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

- Current: `extensions/pi-subagents/src/tool.ts:303-308` handles `details.defined` before the child-state branches.
- Gap: before the fix, `renderResult` had no definition branch. `{ defined, source }` fell through to the child result renderer with empty `id`, `status`, and `agent`.
- Failure impact: every successful `define` displayed an empty `○ @ []` row. The tool result text stayed correct, so this was user-visible correctness, not state loss.
- Default check: `extensions/pi-subagents/src/tool.test.ts:237` renders a definition result and asserts `session agent reviewer`.
- Confidence: High.

#### 2. Medium, fixed — branch restore was not fail-closed

- Current: `extensions/pi-subagents/src/index.ts:57-66` catches branch-read failures and clears the in-memory map. `extensions/pi-subagents/src/definitions.ts:41-46` returns an empty map for non-array input.
- Gap: before the fix, `getBranch()` failures propagated out of `session_start`/`session_tree`, and a non-array value threw inside `for...of`. The previous branch's definitions stayed active.
- Failure impact: a failed branch switch could leave stale session agents startable from the wrong branch. An exception could also skip the `session_start` state emission.
- Default check: `extensions/pi-subagents/src/index.session.test.ts:88` covers a throwing and a non-array branch; `extensions/pi-subagents/src/definitions.test.ts:61` covers non-array helper input.
- Confidence: High.

#### 3. Low, open — direct `define` calls assume string-shaped fields

- Current: `extensions/pi-subagents/src/tool.ts:401-412` calls `.trim()` and `.map()` before validating runtime types.
- Gap: TypeBox protects normal model calls. A direct caller can pass non-strings and receive a generic caught error.
- Failure impact: poor diagnostics only; no state is written before the throw.
- Default check: `extensions/pi-subagents/src/tool.test.ts:298` covers missing fields through the tool schema path.
- Confidence: Medium.

#### 4. Low, deferred — definitions have no size, count, or deletion bound

- Current: `extensions/pi-subagents/src/tool.ts:186-248` declares unbounded strings; `extensions/pi-subagents/src/index.ts:68-71` appends every definition; `extensions/pi-subagents/src/definitions.ts:41` scans the full branch on restore.
- Gap: repeated large definitions grow the session JSONL and the restore scan. There is no delete or eviction action.
- Failure impact: long sessions can accumulate stale definitions and slower branch restores. Markdown agent files have the same unbounded prompt risk, so this is not unique to session definitions.
- Default check: no limit is specified by R79/S170.
- Confidence: Medium.

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

- Should session definitions have a size/count bound or a delete action for very long sessions?
- Should resume preserve an isolated workspace for a failed session-agent child?

## Verification

```bash
npx vitest run extensions/pi-subagents/src
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
git diff --check
```

- Targeted: 15 files, 90 tests passed.
- Full suite: 112 files, 1007 tests passed (`artifacts/logs/session-definitions-robust-review.log`).
- Typecheck passed; lint checked 314 files; `git diff --check` clean.

## Findings

Two medium findings were fixed. The low findings are not blocking: one is outside the normal tool boundary, and one is an unbounded-input policy decision shared with file agents.

## Verdict

Accepted — both blocking findings fixed and verified. No open `Qxx`.
