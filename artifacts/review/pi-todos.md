# Review — pi-todos (V13)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`

Status (2026-10-30): robustness issues and verified bugs fixed. The widget
options overload and unused `statusText` export were removed; todo processing
now runs in every mode.


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

- `todos.ts:4-27` — exports `Todo`, `TodoState`, `TodoCommand`, `TodoUpdate`, `TodoPriority`; pure state machine at `todos.ts:34,50-84,86-138` (`emptyTodoState`, `parseTodoBlock`, `applyTodoCommand`).
- `todos.ts:161-175` — exports `SubagentStateItem` and `TaskStateItem`; implicit event payload contracts for `subagents:state` and `tasks:state` consumed at `index.ts:187-203`.
- `todos.ts:179-185,222-227` — exports `FormatTodoWidgetOptions` and `formatTodoWidget`, allowing another extension to render the combined todo/task/subagent panel.
- `todos.ts:151-159,440-450,452-456` — exports `formatTodoList`, `formatTodoConfirmation`, `statusText`.
- `index.ts:20-21,215` — implicit seam: custom session entry `hollowheap.todos` and message type `hollowheap.todos.updated`; constants not exported.
- `index.ts:220` — markdown transformer strips valid todo blocks; not exposed for reuse.

### Robustness Issues

- `index.ts:271-272` — `event.message.role` accessed without guarding `event.message`.
- `index.ts:274-275` — `contentText(event.message.content)` assumes string/array; `undefined` content throws.
- `index.ts:188-189,197-198` — event payloads cast to typed arrays without validation.
- `index.ts:161-163` — `updateUI` assumes `ctx.ui.setWidget` exists once `ctx.hasUI` is true.
- `index.ts:205-213` — `restore` calls `getBranch()` without try/catch.
- `index.ts:241-260` — `setupTerminalInput` called on `session_start` and `session_tree`; listeners may accumulate.
- `todos.ts:333-335` — split layout only uses `todoSections[0]`, multiple todo sections not handled.
- `todos.ts:404` — collapsed mode returns `undefined`; callers must ensure widget is cleared.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `todos.ts:222-438` — manual box drawing, truncation, side-by-side layout. | R21, R36, R47, R50, D75, D107, D119, D122 | **Required, not overengineering.** R36/D107 require the sticky widget with todos and subagent state; R47/D119 require rounded borders; R50/D122 require unified task/subagent formatting and a collapsed mode; R21/D75 set ten rows. Manual drawing is how those contracts are composed. |
| `todos.ts:179-185` — `FormatTodoWidgetOptions` carries many optional knobs. | R36, R47, R50, D75 | **Required, not overengineering.** `width`, `borderColor`, and `collapsed` are required by R36/R47/R50; `now` is the test seam for elapsed time. No knob is unrequested except the test-only clock. |
| `todos.ts:224-239` — overloaded `tasksOrOptions` parameter complicates call sites. | No R/D | **Fixed.** `formatTodoWidget` now takes `(todos, subagents, tasks, options)` only. |
| `index.ts:42-56,58-70` — `TodoDetails`, `detailsText`, `readTodos` duplicate Todo validation. | R18, D55 | **Required, not overengineering.** D55 stores todo state as a session custom entry and R18 requires restore; `readTodos` validates untrusted session/message details before formatting. This is runtime validation, not a duplicate parser. |
| `index.ts:230-260` — chord keybinding state machine for panel collapse. | R50, D122 | **Required, not overengineering.** D122 explicitly specifies `^x p` and `/panel toggle`; a pending-chord timer is the required behavior. |
| `index.ts:315-355` — separate `/todos` TUI dialog duplicates list rendering. | R18, R51, D57, D123 | **Required, not overengineering.** R18/D57 require `/todos` to list every todo; R51/D123 add search. The dialog is the TUI presentation, not an extra feature. |
| `todos.ts:452-456` — `statusText` exported/tested but never called internally. | No R/D | **Fixed.** Removed with its test. |

### Verified Bugs (2026-10-29)

Probe: `artifacts/scripts/probe-todos-overflow.ts`. All findings below were
fixed on 2026-10-30; the table is kept as the original evidence.

| Severity | Finding | Evidence |
| --- | --- | --- |
| High | Open todos are hidden behind completed todos. The widget slices the priority-sorted list (`todos.ts:261-270`), so ten completed high-priority rows consume `WIDGET_LIMIT` and both open rows disappear behind "+2 more". | Probe prints `OPEN_VISIBLE= false`. |
| Medium | Todo processing is gated on `ctx.hasUI` (`index.ts:272`); RPC/headless sessions ignore `create_todos`/`complete_todos`/`delete_todos` entirely. | Code read. |
| Medium | No `session_compact` handler (`index.ts:262-269`). If compaction drops the custom entries, the next `/reload` restores an empty state. | Code read; upstream rpiv-todo handles compact. |
| Medium | `setupTerminalInput` re-registers on every `session_start` and `session_tree` (`index.ts:241-269`) and ignores any disposer. Reloads/tree switches accumulate chord handlers, so one Ctrl+X then `p` can toggle twice. | Code read. |
| Low | Split-layout divider rows emit `│├` instead of a proper `┼` junction (`todos.ts:393-402`). | Code read. |
| Low | No dependency model: `Todo` has no `blockedBy` and text blocks cannot express one (`todos.ts:6-11,50-84`). Upstream rpiv-todo implements the graph. | Code read. |
| Low | Priority is only reachable through `/todo priority` (`index.ts:483-520`); the system prompt and text blocks never mention it. | Code read; README does not document priority. |
| Low | `readTodos` accepts duplicate IDs (`index.ts:98-133`); `readState` only clamps `nextId` and does not reject duplicates. | Code read. |

### Verification

```bash
npx vitest run extensions/pi-todos/src
```

All 39 `pi-todos` tests pass; the full repository suite and lint/typecheck are
also green.

### Upstream Comparison

`rpiv-todo@1.1.0` has a real `todo` tool, a `blockedBy` graph, cycle detection,
and drop-completed-first overflow. It also has defects: `reconstructTodoState`
caches the branch forever (`todo.ts:89-90,576-595`), cycle detection merges the
old edge set and can false-positive on removal (`todo.ts:146-176,388`), and its
README claims priority management that the code does not implement. It peer-
depends on `@mariozechner/pi-*`, not `@earendil-works/pi-*`. See
`artifacts/research/pi-extension-landscape.md`.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — findings resolved.
