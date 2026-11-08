# Review — pi-usage robustness re-review (V33)

## Scope

- Slice: `extensions/pi-usage/src/index.ts` (350 LOC), `extensions/pi-usage/src/subagents.ts` (428 LOC). Test file read for coverage only (737 LOC, 23 tests, all pass with `npx vitest run extensions/pi-usage`).
- Dependencies read at HEAD: `packages/core/src/usage.ts` (350 LOC, the ledger), `packages/core/src/pricing.ts` (F6 impact only).
- Host: `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:273,311,334`, `extensions/types.d.ts:80,242,664`.
- Commit under review: `85eabb0` (usage:refresh listener, index.ts:167-172).
- Cross-check consumers: `extensions/pi-memory/src/index.ts:190-203`, `extensions/pi-statusline/src/index.ts:39-80`.
- The working-tree change in `extensions/pi-agent` was ignored.
- Note: no overlay or table exists in this slice. The `/usage` output is one `ctx.ui.notify` string (index.ts:43-101, 341-345). The UI lens is applied to that string.
- Probes ran from `/tmp/pu-probe` through `node_modules/.bin/jiti`, then the directory was deleted. No repo file was edited.

## Prior resolutions

V15 (`artifacts/review/pi-usage.md`):

1. `budgetCap`/`budgetWarning` unused, needs setter: holds. `/usage cap` at index.ts:306-336, setter usage.ts:296-311.
2. `extractLatestUsage` drops `budgetWarning`: holds. usage.ts:188 restores it.
3. `calculateCostFromModel` single-use wrapper: holds. Symbol absent (grep: 0 hits).
4. Cost priced from `ctx.model` instead of message model: holds. index.ts:218-224 prefers `event.message.model`.
5. `byModel` unvalidated cast: holds. usage.ts:54-83 validates each field.
6. `restoreSessionUsage` wipes state when no accessor exists: holds. usage.ts:339 returns current state. The accessor order is a new defect (F1), not this item.
7. Per-model and total cost rounded independently: holds. usage.ts:249,253 round each step to 1e-9, so drift does not accumulate.
8. `totalTokens` excludes cache: holds. usage.ts:261 and 178 include cache tokens.
9. Module-global `activeUsage` never reset: holds. usage.ts:275 is a WeakMap; `clearSessionUsage` at index.ts:194-196.
10. Subagent attribution "unimplemented" (V15 status line): changed, not regressed. subagents.ts implements it. The V15 status text is stale.
11. Duck-typed `getEntries`/`getBranch` kept for D24: holds as a requirement. Its ordering is wrong (F1).

V17 (`artifacts/review/ui-upgrades.md`): no pi-usage item. Line 55 lists `/budgets`, which V15 records as retired. Nothing to check.

Commit 85eabb0 (`usage:refresh`): holds. index.ts:167-172 restores and republishes, and the added test at `index.test.ts` passes. It inherits F1 (same restore path) and F9 (overwrites in-memory state).

Regressed prior resolutions: 0 of 11 V15 items, 0 of V17 items.

## Cross-slice impact (V22, packages-core.md)

- F6 (pricing returns undefined, cache tokens priced at $0 without a cache rate): pi-usage feeds it at index.ts:224-236 (`turnCost = 0` when pricing is undefined) and subagents.ts:84-93. Impact: an unpriced model adds $0 to `totalCost`, so the `/usage cap` limit never triggers for that model, and the statusline `$used/$cap` is understated. Not re-reported here.
- Ledger growth (V22 line 133): each `message_end` appends a full snapshot that includes the subagent rows (index.ts:247-248, usage.ts:260-270). Measured 1,760 bytes per snapshot with 5 subagents (F5). Restore cost is O(entries) on every `session_start`, `session_tree`, `usage:refresh`, and `before_agent_start` restore path.
- Ledger concurrency (V22 line 178): pi-usage writes nothing to disk directly. It appends through `appendCustomEntry` (session-manager.d.ts:273). Multi-process write safety is host-side and UNVERIFIED here.

## Findings

Severity legend: high = wrong money or budget decision in normal use. medium = wrong number or cost in a reachable path. low = cosmetic, dead code, or narrow path.

### F1 — branch restore reads every session entry, not the active branch
- Severity: high. Lens: Robustness.
- Current: `packages/core/src/usage.ts:329-331`:
  `if (typeof manager.getEntries === "function") { ... entries = manager.getEntries();` and the `getBranch` path is only the `else` (usage.ts:335-337).
- Gap: host `getEntries()` returns all entries in file order (session-manager.d.ts:334). `getBranch()` returns the path from the leaf (session-manager.d.ts:311). `extractLatestUsage` takes the last snapshot in file order. After `/tree` moves to another branch (`session_tree`, index.ts:184-192), the restored total comes from the last snapshot written, which may belong to the abandoned branch. `pi-memory` builds its snapshot from the same restore (`extensions/pi-memory/src/index.ts:190-203`), so the wrong base is propagated.
- Failure: after navigating to branch A, the displayed and capped cost is branch B's total, and the next persisted snapshot carries B's spend into A.
- Reproduction: probe with two branches, A snapshot cost 0.50 written first, B snapshot cost 0.10 written later, leaf on A. `restoreSessionUsage({getEntries: all, getBranch: [A entries]})` returned `totalCost=0.1`, `byModel` keys `['m-b']`. Expected 0.5. The existing test (index.test.ts:82) mocks only `getEntries` and has no two-branch case.
- Fix: call `getBranch()` first and use `getEntries()` only if `getBranch` is absent. Add a two-branch test.
- Confidence: high (probe on fabricated entries; host doc confirms the semantics).

### F2 — persisted subagent rows are replaced wholesale when any child is missing
- Severity: medium. Lens: Robustness (subagent attribution).
- Current: `extensions/pi-usage/src/index.ts:116`: `subagentRows = scanned.length > 0 ? scanned : (current.subagents ?? []);`
- Gap: the fallback to persisted rows happens only when the scan is empty. Per row, a missing or unreadable child is dropped, not kept. `scanSubagentUsage` skips a state file that fails `JSON.parse` (subagents.ts:336-337) and marks a row `available:false` when its child JSONL is unreadable (subagents.ts:358, 364). `combineUsage` skips unavailable rows (subagents.ts:383).
- Failure: spend from subagent A disappears from `totalCost` once A's state or child file is gone or unreadable and B is still readable. `/usage` and the cap check then show a lower cost, and `before_agent_start` (index.ts:265-267) can let a run start after the cap was reached.
- Reproduction (reasoned from code, not executed): persisted snapshot has `subagents=[A cost 0.5, B cost 0.3]`. Delete `subagents/A.json`, keep `B.json` and its session file. `refreshSubagents` sets `subagentRows=[B]`. Combined total is 0.3, not 0.8. The existing test covers only the all-gone case.
- Fix: merge by `id`: take the fresh row when available, otherwise keep the persisted row for that id.
- Confidence: high on mechanism, medium on how often state files disappear (UNVERIFIED: pi-subagents does not delete `*.json` state files in the code paths read, `runner.ts:168` removes only `.runner.json`).

### F3 — two cost sources for the same assistant message
- Severity: medium. Lens: Backend (consistency), Robustness.
- Current: index.ts:224-236 always prices with `calculateDollarCost` from the table and ignores `event.message.usage.cost.total`. subagents.ts:84-93 uses the provider `cost.total` first and falls back to the table. `extensions/pi-statusline/src/index.ts:60` sums provider `cost.total`, and lines 71-78 fall back to the table without cache tokens. `pi-memory` prefers provider cost (`pi-memory/src/index.ts:174-181`).
- Gap: the same message kind yields different dollars depending on which writer or reader handles it. pi-statusline also reads `getBranch()` correctly (index.ts:42), while pi-usage reads all entries (F1).
- Failure: the parent ledger, the subagent rows, and the statusline show different totals for one session. The cap decision follows the pi-usage number, which can differ from the provider bill.
- Reproduction (reasoned, not executed): assistant message with `usage.cost.total=0.02` and a table price that yields 0.05. Parent records 0.05 (index.ts:224-236), statusline shows 0.02 (statusline index.ts:60).
- Fix: pick one rule, preferably provider cost when finite and non-zero, else table, and apply it in one core function used by all four readers.
- Confidence: high (code paths confirmed; numeric example depends on the price table entry, UNVERIFIED for a specific model).

### F4 — per-prompt sync rescan of every child session
- Severity: medium. Lens: Performance.
- Current: `index.ts:265-267` calls `refreshSubagents` in every `before_agent_start`. It calls `scanSubagentUsage` (subagents.ts:320-372), which `readFileSync`s every child JSONL (subagents.ts:184-197) and `JSON.parse`s every line. `usage:refresh` (index.ts:167-172) repeats the scan, and pi-memory emits it per observer turn (`pi-memory/src/index.ts:203`).
- Gap: no cache keyed by path, mtime, or size, although `packages/core/src/mtime-cache.ts:27` (`MtimeCache`) exists.
- Failure: prompt latency grows with the total size of child logs, not with the current session.
- Measured (single run, this machine): 20 subagents × 200 assistant messages, one scan: 23 ms. 200 × 2000: 730 ms. 5,000 unrelated state files (other parents): 65 ms per call, with `parentSession` filtered after parse (subagents.ts:333-340).
- Fix: cache parsed child usage by `(path, mtimeMs, size)` with `MtimeCache`. Skip the whole rescan when `subagents:state` reports no change.
- Confidence: high for the measured numbers. The threshold where it hurts is UNVERIFIED.

### F5 — every turn persists subagent rows, so the ledger and restore grow with subagents
- Severity: medium. Lens: Performance (ledger growth).
- Current: `index.ts:247-248` persists `next`, which carries `subagents` from `current` (usage.ts:260-270 keeps `current.subagents`). `extractLatestUsage` runs `readByModel` and `readSubagents` on every matching snapshot, not only the last one (usage.ts:134-200).
- Gap: the parent totals do not need the subagent rows, because `refreshSubagents` recomputes them from disk.
- Measured: snapshot size 1,760 bytes with 5 subagents. `extractLatestUsage` over 100,000 snapshots with 5 subagents: 259 ms per restore (cost is O(N × subagents)).
- Failure: a long session writes about 176 MB of snapshots at 100k turns, and each restore parses all of them.
- Fix: strip `subagents` before `persistUsage`, and read only the last matching snapshot (scan backwards).
- Confidence: high for size and time. The 176 MB figure is arithmetic from the measured size, not a session measurement.

### F6 — `/usage cap` accepts trailing garbage and truncates silently
- Severity: medium. Lens: Backend (validation).
- Current: `extensions/pi-usage/src/index.ts:317-318`: `const amountText = value.startsWith("$") ? value.slice(1).trim() : value; const amount = Number.parseFloat(amountText);`
- Gap: `parseFloat` reads a numeric prefix. Probe results: `"5abc"` → 5, `"5.5.5"` → 5.5, `"$7 extra"` → 7, `"1e3"` → 1000.
- Failure: `/usage cap 50,000` sets a $50 cap, and the run is blocked at $50 (index.ts:265-275) without a warning that the input was misread.
- Reproduction: probe above (executed with the same expression).
- Fix: `/^\$?\d+(\.\d+)?$/` on the trimmed value, then notify an error for anything else.
- Confidence: high.

### F7 — cap and totals print as `$0.00`
- Severity: low. Lens: UI.
- Current: index.ts:87 (`Budget: $${…toFixed(2)} / $${…toFixed(2)}`), index.ts:302 and 333 (`budget cap $${amount.toFixed(2)}`).
- Gap: `formatDollarCost` (already used at index.ts:127 and 80) is not used here.
- Failure: `/usage cap $0.001` reports `budget cap $0.00`, and the report reads `Budget: $0.00 / $0.00`.
- Reproduction: `(0.001).toFixed(2)` = `"0.00"` (probe, executed).
- Fix: use `formatDollarCost` for caps and totals.
- Confidence: high.

### F8 — `/usage cap` warning ignores subagent spend
- Severity: low. Lens: Robustness.
- Current: `packages/core/src/usage.ts:296-311` (`setSessionBudgetCap`) computes `budgetWarning` from `getSessionUsage(owner)`, which is parent-only. The command at index.ts:333 then reports "(warning threshold reached)" from that value.
- Gap: `combined()` (index.ts:122) includes subagent cost. The two values disagree.
- Failure: with parent $0.10 and subagents $0.90, `/usage cap 1` reports no threshold, but the report and statusline show 90%. The next `message_end` then emits a second warning, because the persisted parent flag is unset.
- Reproduction (reasoned): `setSessionBudgetCap(owner, 1)` with parent `totalCost=0.1` returns `budgetWarning` undefined.
- Fix: compute the flag from `combined()`, or pass the combined total into the core setter.
- Confidence: medium (logic is clear; the duplicate-warning sequence is UNVERIFIED in the host).

### F9 — `usage:refresh` overwrites unsaved in-memory spend
- Severity: low. Lens: Robustness.
- Current: index.ts:167-172 calls `restoreSessionUsage`, which runs `setSessionUsage(manager, restored)` (usage.ts:347-348).
- Gap: `persistUsage` swallows append errors (usage.ts:313-322). When an append fails, memory holds spend that is not on disk, and the next refresh replaces it with the older snapshot.
- Failure: a failed persist followed by any `usage:refresh` (pi-memory emits one per observer turn) drops that turn's cost from the cap and the report.
- Reproduction: probe with `appendCustomEntry` throwing, `recordTurnUsage` cost 0.5 stored, then `restoreSessionUsage` with empty entries. Result: `totalCost` 0 (executed).
- Fix: on a failed persist, keep a dirty flag and skip restore while dirty, or merge the restored snapshot with in-memory totals.
- Confidence: high on mechanism. Real-world frequency of append failure is UNVERIFIED.

### F10 — duplicated helpers and dead export in the slice
- Severity: low. Lens: Simplicity.
- `extensions/pi-usage/src/subagents.ts:270-285` (`readByModel`) repeats `packages/core/src/usage.ts:54-83`. `subagents.ts:34-40` (`isRecord`, `numberOrZero`) repeats the core validators. `index.ts:39-41` (`isNonNegativeNumber`) repeats `usage.ts:46`.
- `subagents.ts:287` (`readSubagentUsageSnapshot`) has no consumer. Grep over `extensions` and `packages` finds only its definition.
- `index.ts:20-38` re-exports 13 core symbols. The only external import of this package is `pi-guard/src/integration.test.ts:9` (default export).
- `extensions/pi-statusline/src/index.ts:39-80` (`sumTokens`) is a second cost seam over the same ledger (see F3).
- Fix: delete `readSubagentUsageSnapshot`, import the core validators, and cut re-exports to what has consumers.
- Confidence: high (grep-verified).

### F11 — report output has no width or length bound
- Severity: low. Lens: UI.
- Current: `index.ts:65` (per-model line, raw `m.model`) and `index.ts:80` (subagent line, raw `subagent.model`, `subagent.agent`). One `ctx.ui.notify` call (index.ts:341-345).
- Gap: no truncation, no pager, and no key handling. The "fits at 40/80/200 columns" check cannot run against a string notify.
- Failure: a 120-character model id or 60 subagent rows produce a long multi-line toast. Behavior at 40 columns is UNVERIFIED because the host renders `notify` text in a TUI component not read here.
- Fix: cap model/agent names with `truncateToWidth` from pi-tui, and cap the row count with a "+N more" line.
- Confidence: low (UNVERIFIED host rendering).

## Failure modes

- Multi-process: pi-usage writes no files. The shared write point is the session file through `appendCustomEntry`. Concurrent writes from two processes on one session are UNVERIFIED.
- Subagent state reads (subagents.ts:336) are unlocked. A half-written state file is skipped silently, which yields F2's effect for one refresh. pi-subagents writes through `LockedProcessStore`, so reads are probably atomic. UNVERIFIED.
- Child session with a snapshot followed by messages: `readChildUsage` returns the snapshot and ignores later messages (subagents.ts:244-251). Reachable only if the last persist failed. UNVERIFIED.
- Clock and timezone: N/A. `Date` is not used in `extensions/pi-usage/src` or `packages/core/src/usage.ts` (grep). No daily or monthly boundary exists.
- Session switch and fork: F1 covers `session_tree`. `session_start` uses the same restore and the same ordering. Fork behavior depends on how the host copies entries on fork (UNVERIFIED).
- Budget overshoot: the cap is checked only at `before_agent_start`. A single long turn or a tool-driven continuation can exceed the cap before the next check. This is by design, not a defect.
- Abort during start: the host honors `ctx.abort()` in `before_agent_start` (agent-session.js:710-713), so the 100% block works.

## Seams

- `index.ts` → `@hollowheap/core/usage` (ledger) and `@hollowheap/core/pricing`: the ledger is the right seam. Subagent parsing (`subagents.ts`) is pi-usage-specific and belongs here.
- Second cost seam: pi-statusline `sumTokens` (statusline index.ts:39-80). Consolidate with F3.
- Write seam: pi-memory writes the ledger directly (`pi-memory/src/index.ts:190-203`), then emits `usage:refresh`. Two writers, one format. A core `appendUsageSnapshot(manager, delta, cost)` would remove the duplicate.
- Event seam: `statusline:values`, `statusline:request`, `subagents:state`, `usage:refresh`. All are untyped (`data: unknown`). Validation exists at each consumer.

## Rejected defaults

- Rewriting the ledger as an append-only delta log: rejected. Snapshots keep restore O(1) per entry once F5 is fixed, and a delta log adds replay code.
- Adding a file lock around the ledger in pi-usage: rejected. pi-usage writes no files. The lock would belong to the host session store.
- Caching subagent scans by directory mtime alone: rejected. Directory mtime does not change when a child JSONL grows. Use per-file `(mtime, size)` (F4).
- Parsing with a stricter schema library: rejected for this slice. The hand-written guards in core cover the fields used.

## Open Questions

1. Does the host call `session_tree` after `/tree` navigation and after fork in the same process? (Needed to confirm F1 end to end.)
2. Does `appendCustomEntry` ever throw in the host, and under what condition? (Needed to size F9.)
3. Do pi-subagents users delete `subagents/*.json` or child sessions? (Needed to size F2.)
4. Should the cap use provider-reported cost (F3), or the local table? This is a policy decision.
5. What width and truncation does the host apply to `ctx.ui.notify` text? (Needed for F11.)

## Verdict

Not safe to rely on for cap enforcement until F1, F2, and F3 are fixed. F1 can report another branch's spend after `/tree`. F2 can drop subagent spend from the total. F3 gives two different dollar figures for the same message. Prior V15 items all hold (0 regressed). Commit 85eabb0 works as tested but reuses the F1 restore path.
