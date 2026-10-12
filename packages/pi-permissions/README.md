# pi-permissions

Checks file paths against allow/deny rules before file tools run. Registers no tools and changes no tool schemas; it only observes `tool_call` and blocks denied calls.

## Try it

```bash
pi -e ./packages/pi-permissions
```

## Install

```bash
pi install npm:@my-scope/pi-permissions
```

## Rules

Create `<project>/.pi/permissions.json`:

```json
{
  "rules": [
    "deny write *",
    "allow write artifacts/specs/*.md",
    "allow write artifacts/plan/*.md"
  ]
}
```

Each rule is `"effect verb pattern"` or `{ "effect", "verb", "pattern" }`. `effect` is `allow` or `deny`; `verb` is `read` or `write`. Rules apply in order and the last matching rule wins; nothing matching means deny. When a winning `allow` ties on specificity (pattern length without wildcards) with a matching `deny`, the deny wins.

Patterns match the whole path relative to the project root. `*` spans directories and `?` matches one character, so `*` alone matches everything and `artifacts/specs/*.md` matches `artifacts/specs/a.md`. Every path resolves against the project root first, following symlinks; paths escaping the root (`../`, absolute paths elsewhere, symlinks pointing outside) are always denied.

## Hooked tools

| tool | checked as |
|---|---|
| `write`, `edit` | `write` |
| `find`, `grep` (`fd`, `rg` aliases) | `read` |

Pi names its search tools `find` and `grep`; the `fd`/`rg` names are accepted too. `bash` is deliberately unchecked: it can still write outside allowed paths until bash rules exist. Other tools pass through untouched.

## /cd

`/cd <path>` changes the working directory for file tools. The path must be an existing directory inside the project root and pass `check(rules, path, "read")`; otherwise an error is shown and the directory is unchanged. The project root never changes. Bare `/cd` resets to the project root.

Pi exposes no API to move the session directory, so this rewrites relative `path` arguments of `read`, `write`, `edit`, `find`, `grep`, `ls`, `fd`, and `rg` tool calls to the new directory before the rules verdict. Absolute paths and `bash` are unaffected. The new directory is shown via `setStatus("cwd", …)` for status lines that render extension statuses, plus a one-line notification.

## Built-in tools

The package also registers permission-enforcing `fd` and `rg` tools for projects whose rules allow reading:

- `fd` — `pattern` (glob, required), `path` (optional, defaults to working directory), `max_results` (1–500, default 100). Runs the `fd` binary with `--glob`, drops denied paths, returns root-relative paths newest first.
- `rg` — `pattern` (regex, required), `path` (optional), `glob` (optional file filter), `max_results` (1–500, default 100). Runs the `rg` binary, drops matches from denied files, returns `path:line:text` lines cut to 300 characters.

Both run their binary with an argument array and no shell, and fail with a clear error when the binary is not installed. The `tool_call` hook still gates their search root first; per-result filtering applies on top, so usable searches need `allow read` rules.

Without a rules file (or with an unreadable one) the extension warns once and allows everything, so fresh projects keep working until rules are written.
