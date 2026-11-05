# pi-todos

Manage branch-local todos with tagged blocks in assistant text. No model tool is
registered.

## Try it

```bash
pi -e ./extensions/pi-todos
```

## Block format

Create tasks with exactly one ordered list:

```text
```create_todos
1. Write the parser tests
2. Update the README
```
```

Complete tasks by numeric ID with exactly one ordered list:

```text
```complete_todos
1. 2
```
```

Fences support both markdown backticks (```` ```create_todos ````) and triple single quotes (`'''create_todos`). `create_todos` appends tasks and assigns stable numeric IDs; it never replaces
the list. `complete_todos` marks matching IDs done and reports unknown IDs.
Do not add checkboxes or use unordered lists. Only closed, valid blocks are
handled; invalid, unknown, and unclosed blocks stay visible.

After a message with a valid block, one `hollowheap.todos.updated` follow-up
lists every todo with its ID and done marker, so the model can learn the
assigned IDs.

## State

State is stored in a `hollowheap.todos` custom session entry on the active
branch. It is restored on session start and branch navigation, and re-appended
after compaction so resume and fork stay consistent. There is no global or
project-file state.

## UI

- A width-aware component widget above the editor displays open todos, running shell tasks, and active subagents inside a rounded Unicode border (`╭─ ... ─╮`, `│ ... │`, `╰─ ... ─╯`). When the host renders at 80+ columns and both todos and background jobs are active, sections split into side-by-side columns.
  - Todos list up to ten items, open todos first, with status icons (`•` open, `✓` completed with strikethrough). Completed rows cannot crowd out open work. When more remain, it adds a `+N more (/todos)` line.
  - Running background tasks (from `pi-tasks`) and active subagents (from `pi-subagents`) appear in dedicated sub-sections separated by divider borders (`├─ ... ─┤`).
  - The widget clears when all sections are empty.
- `/todos` shows the full list; `/todos search <query>` filters it. TUI opens a
  closeable list (Esc, Enter, q, or Ctrl+C); RPC uses a notification.
- `/todo complete <id|all>`, `/todo edit <id> <text>`, `/todo delete [id]`, and
  `/todo priority <id> <high|medium|low>` manage the list. Priorities sort the
  widget and list; the model can learn priority from the prompt section but
  cannot set it through a todo block.
- `/panel toggle` or `^x p` collapses and expands the sticky panel.
- The TUI transcript strips valid todo blocks. The stored message, model
  context, and RPC clients keep the raw fence.

## Mode behavior

Todo blocks and the `todos_format` prompt section are active in every mode,
including print and JSON, so headless runs still persist state. Widgets,
notifications, and `/todos` dialogs require UI support; without a UI the state
and follow-up confirmation still work. Terminal chord listeners are disposed
when the session shuts down, so reloads do not stack handlers.
