# pi-permissions

Checks tool calls against tagged allow/deny/ask rules. Anything unmatched asks the user for approval; `fd`/`rg` search tools and a `/cd` command are included.

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
    "deny edit *",
    "allow edit artifacts/specs/*.md",
    "allow edit artifacts/plan/*.md"
  ]
}
```

Each rule is `"effect tag pattern"` or `{ "effect", "tag", "pattern" }`. `effect` is `allow` or `deny`; `tag` is `edit`, `read`, `search`, or `shell`. Rules apply in order and the last matching rule wins. When a winning `allow` ties on specificity (pattern length without wildcards) with a matching `deny`, the deny wins. When nothing matches, the call asks the user for approval instead — there are no default allow rules, so a sane setup asks first and specialized agents add `deny` rules.

Patterns match the whole path relative to the project root. `*` spans directories and `?` matches one character, so `*` alone matches everything and `artifacts/specs/*.md` matches `artifacts/specs/a.md`. Every path resolves against the project root first, following symlinks; paths escaping the root (`../`, absolute paths elsewhere, symlinks pointing outside) are always denied.

## Hooked tools

| tool | tag | checked text |
|---|---|---|
| `write`, `edit` | `edit` | file path |
| `read` | `read` | file path |
| `find`, `grep`, `fd`, `rg`, `ls` | `search` | search root path |
| `bash`, `powershell` | `shell` | full command text |

Pi ships `find`, `grep`, and `ls` in core but they are opt-in — default sessions only have `read`, `bash`, `edit`, `write` active, which is why this package also provides its own always-available `fd`/`rg` below.

Denied calls return `{ block: true, reason }`. Unmatched calls ask via a confirmation dialog, and anything else unknown (custom and MCP tools included) asks too. Without dialog-capable UI the ask becomes a block. Shell patterns match against the raw command text, so `deny shell *` blocks everything while `allow shell "git *"` permits git commands — note a matched prefix still runs the whole command line, so review approval prompts carefully.

## /cd

`/cd <path>` changes the working directory for file tools. The path must be an existing directory inside the project root and pass `check(rules, path, "read")`; otherwise an error is shown and the directory is unchanged. The project root never changes. Bare `/cd` resets to the project root.

Pi exposes no API to move the session directory, so this rewrites relative `path` arguments to the new directory before the rules verdict. Absolute paths are unaffected. The new directory is shown via `setStatus("cwd", …)` for status lines that render extension statuses, plus a one-line notification.

## Built-in tools

The package also registers permission-enforcing `fd` and `rg` tools for projects whose rules allow reading:

- `fd` — `pattern` (glob, required), `path` (optional, defaults to working directory), `max_results` (1–500, default 100). Runs the `fd` binary with `--glob`, keeps only explicitly allowed paths, returns paths relative to the working directory (the `/cd` directory when set) newest first.
- `rg` — `pattern` (regex, required), `path` (optional), `glob` (optional file filter), `max_results` (1–500, default 100). Runs the `rg` binary, keeps only matches from explicitly allowed files, returns `path:line:text` lines cut to 300 characters, paths relative to the working directory (the `/cd` directory when set).

Both run their binary with an argument array and no shell, and fail with a clear error when the binary is not installed. The `tool_call` hook still gates their search root first; per-result filtering applies on top, so usable searches need `allow search` rules.

Without a rules file (or with an unreadable one) the extension warns once and asks for approval on every gated call, so fresh projects keep working with oversight until rules are written.
