# pi-todos Review

## Public Seams

- `todos.ts:4-27` — exports `Todo`, `TodoState`, `TodoCommand`, `TodoUpdate`, `TodoPriority`; pure state machine at `todos.ts:34,50-84,86-138` (`emptyTodoState`, `parseTodoBlock`, `applyTodoCommand`).
- `todos.ts:161-175` — exports `SubagentStateItem` and `TaskStateItem`; implicit event payload contracts for `subagents:state` and `tasks:state` consumed at `index.ts:187-203`.
- `todos.ts:179-185,222-227` — exports `FormatTodoWidgetOptions` and `formatTodoWidget`, allowing another extension to render the combined todo/task/subagent panel.
- `todos.ts:151-159,440-450,452-456` — exports `formatTodoList`, `formatTodoConfirmation`, `statusText`.
- `index.ts:20-21,215` — implicit seam: custom session entry `hollowheap.todos` and message type `hollowheap.todos.updated`; constants not exported.
- `index.ts:220` — markdown transformer strips valid todo blocks; not exposed for reuse.

## Robustness Issues

- `index.ts:271-272` — `event.message.role` accessed without guarding `event.message`.
- `index.ts:274-275` — `contentText(event.message.content)` assumes string/array; `undefined` content throws.
- `index.ts:188-189,197-198` — event payloads cast to typed arrays without validation.
- `index.ts:161-163` — `updateUI` assumes `ctx.ui.setWidget` exists once `ctx.hasUI` is true.
- `index.ts:205-213` — `restore` calls `getBranch()` without try/catch.
- `index.ts:241-260` — `setupTerminalInput` called on `session_start` and `session_tree`; listeners may accumulate.
- `todos.ts:333-335` — split layout only uses `todoSections[0]`, multiple todo sections not handled.
- `todos.ts:404` — collapsed mode returns `undefined`; callers must ensure widget is cleared.

## Overengineering

- `todos.ts:222-438` — ~216-line widget renderer with manual box drawing, truncation, side-by-side layout.
- `todos.ts:179-185` — `FormatTodoWidgetOptions` carries many optional knobs.
- `todos.ts:224-239` — overloaded `tasksOrOptions` parameter complicates call sites.
- `index.ts:42-56,58-70` — `TodoDetails`, `detailsText`, `readTodos` duplicate Todo validation.
- `index.ts:230-260` — chord keybinding state machine for panel collapse.
- `index.ts:315-355` — separate `/todos` TUI dialog duplicates list rendering.
- `todos.ts:452-456` — `statusText` exported/tested but never called internally.