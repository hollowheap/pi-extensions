# pi-mode-guard

Checks tool calls against tagged allow/deny/ask rules. Anything unmatched asks the user for approval; `fd`/`rg` search tools and a `/cd` command are included.

## Try it

```bash
pi -e ./packages/pi-mode-guard
```

## Install

```bash
pi install npm:@my-scope/pi-mode-guard
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
| `bash`, `powershell` | allowlist (`shell` tag) | command name + argument prefix |

Pi ships `find`, `grep`, and `ls` in core but they are opt-in — default sessions only have `read`, `bash`, `edit`, `write` active, which is why this package also provides its own always-available `fd`/`rg` below.

Denied calls return `{ block: true, reason }`. Unmatched calls ask via a confirmation dialog, and anything else unknown (custom and MCP tools included) asks too. Without dialog-capable UI the ask becomes a block.

## Bash allowlist

Bash is denied by default; only commands named in the rules file run:

```json
{
  "rules": [
    "allow shell git status",
    "allow shell rg",
    "allow shell ls"
  ]
}
```

Each rule names a command plus an optional argument prefix (`allow shell git status` permits `git status --short` but not `git log`). Commands chained with `&&`, `||`, `;`, or `|` are split and every part needs its own allow rule. A part is denied when it has no matching rule, and always denied when it uses `sh`, `bash`, `zsh`, `eval`, `xargs`, `env`, `sudo`, `tee`, or `dd` (even if allowed), contains a redirect (`>`, `>>`), or contains `$(` or backticks. Allowed commands run without asking; per-call approvals arrive with prompt 7. Bash output over 4000 characters is cut to the first 3000 and last 1000 with a cut count line. File paths are never checked for shell commands — the allowlist is the only gate, and it covers `bash` and `powershell` alike.

## /cd

`/cd <path>` changes the working directory for file tools. The path must be an existing directory inside the project root and pass `check(rules, path, "read")`; otherwise an error is shown and the directory is unchanged. The project root never changes. Bare `/cd` resets to the project root. Directory names autocomplete best-effort against the launch directory.

Pi exposes no API to move the session directory, so this rewrites relative `path` arguments to the new directory before the rules verdict. Absolute paths are unaffected. The new directory is shown via `setStatus("cwd", …)` for status lines that render extension statuses, plus a one-line notification.

## Modes

`/mode [plan|ask|edit|autopilot]` shows or switches the plan/approval level. Modes live in session state only, never on disk; every session starts in `ask`. Unknown values are rejected. Mode names autocomplete, and `shift+tab` cycles plan, ask, edit, autopilot in order (note: pi binds the same key to thinking-cycle by default — unbind `app.thinking.cycle` if both fire).

| mode | writes (`edit`) |
|---|---|
| `plan` | only `artifacts/plan.md` + `artifacts/specs.md`, always asks; everything else denied |
| `ask` (default) | normal allow/deny/ask flow |
| `edit` | allowed writes run silently |
| `autopilot` | allowed writes run silently |

Shell commands ignore modes: the allowlist decides, and per-call approvals arrive with prompt 7.

Deny beats every mode: a denied call never runs and never asks. Entering `plan` appends `allow edit` rules for the two plan files in memory only (removed on exit), so planning works under deny-heavy configs. Writes to the plan files always ask, in every mode — accepting a plan is the approval dialog itself, and a rejection is never written anywhere. Switching to `autopilot` without a token cap is refused, and turning it on shows a chat warning.

## Budget

`/budget [tokens]` shows or sets the session token budget in whole tokens. After each model response the input and output usage accumulate into a session total (responses without usage are reported and skipped, never estimated). Once the total reaches the cap, further model calls are aborted with a message until `/budget` raises the cap. A cap of 0 or less is rejected. Used and remaining tokens show in the `budget` status text and print on every `/budget` call. The same cap gates `autopilot` mode.

## Built-in tools

The package also registers permission-enforcing `fd` and `rg` tools for projects whose rules allow reading:

- `fd` — `pattern` (glob, required), `path` (optional, defaults to working directory), `max_results` (1–500, default 100). Runs the `fd` binary with `--glob`, keeps only explicitly allowed paths, returns paths relative to the working directory (the `/cd` directory when set) newest first.
- `rg` — `pattern` (regex, required), `path` (optional, directory or file), `glob` (optional file filter), `max_results` (1–500, default 100). Runs the `rg` binary, keeps only matches from explicitly allowed files, returns `path:line:text` lines cut to 300 characters, paths relative to the working directory (the `/cd` directory when set).

Both run their binary with an argument array and no shell, and fail with a clear error when the binary is not installed. The `tool_call` hook still gates their search root first; per-result filtering applies on top, so usable searches need `allow search` rules.

Without a rules file (or with an unreadable one) the extension warns once and asks for approval on every gated call, so fresh projects keep working with oversight until rules are written.

## Statusline values

This package publishes `mode-guard` (current mode) and `budgets` (used/remaining tokens) values for statusline extensions over pi's shared event bus, following the protocol in `pi-statusline`'s README. No imports cross between the packages in either direction.
