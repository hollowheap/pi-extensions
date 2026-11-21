# pi-todos

Manage branch-local todos through the codemode `todo` tool. No tagged todo blocks are used.

## Try it

```bash
pi -e ./extensions/pi-todos
```

## Tool

Call `tools.todo({...})` from a codemode script. Supported actions:

- `create`: `tasks` (string array) or `text`
- `complete`: `ids` (number array) or `id`
- `delete`: `ids` or `id`; with no ids, clears completed todos when all are done
- `edit`: `id` and `text`
- `priority`: `id` and `priority` (`high`, `medium`, `low`)
- `list`: no extra arguments

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
- `/todos` shows the full list and `/todos search <query>` filters it. In TUI
  mode, close the list with Esc, Enter, q, or Ctrl+C. RPC uses a notification.
- `/todos complete <id|all>`, `/todos edit <id> <text>`, `/todos delete [id]`,
  and `/todos priority <id> <high|medium|low>` manage the list. Priorities sort
  the widget and list.
- `/widget toggle` toggles all sticky widgets. After Alt+W, press T for todos,
  B for tasks, S for subagents, or P for all. On macOS, press Option+W instead.
  Pi lists the prefix under Extensions in `/hotkeys`.

## Mode behavior

The codemode `todo` tool and its prompt guidelines are active in every mode,
including print and JSON, so headless runs still persist state. Widgets,
notifications, and `/todos` dialogs require UI support; without a UI the state
still works. Terminal chord listeners are disposed when the session shuts down,
so reloads do not stack handlers.
