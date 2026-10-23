# pi-todos

Manage branch-local todos with tagged blocks in assistant text. No model tool is
registered.

## Try it

```bash
pi -e ./packages/pi-todos
```

## Install

```bash
pi install npm:@hollowheap/pi-todos
```

## Block format

Create tasks with exactly one ordered list:

```text
'''create_todos
1. Write the parser tests
2. Update the README
'''
```

Complete tasks by numeric ID with exactly one ordered list:

```text
'''complete_todos
1. 2
'''
```

`create_todos` appends tasks and assigns stable numeric IDs; it never replaces
the list. `complete_todos` marks matching IDs done and reports unknown IDs.
Do not add checkboxes or use unordered lists. Only closed, valid blocks are
handled; invalid, unknown, and unclosed blocks stay visible.

After a message with a valid block, one `hollowheap.todos.updated` follow-up
lists every todo with its ID and done marker, so the model can learn the
assigned IDs.

## State

State is stored in a `hollowheap.todos` custom session entry on the active
branch. It is restored on session start and branch navigation, so resume and
fork stay consistent. There is no global or project-file state.

## UI

- A compact widget above the editor lists up to five open todos with their IDs.
  When more remain, it adds a `+N more (/todos)` line. It clears when no open
  todos remain.
- `/todos` shows the full list. TUI opens a closeable list (Esc, Enter, q,
  or Ctrl+C); RPC uses a notification.
- The status count shows `open/total` and clears when the list is empty.
- The TUI transcript strips valid todo blocks. The stored message, model
  context, and RPC clients keep the raw fence.

## Mode gating

Todo blocks and the `todos_format` prompt section are active only when a UI is
available (TUI and RPC). Print and JSON modes add no prompt section, ignore
todo blocks, and open no dialogs.
