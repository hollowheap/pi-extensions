# pi-guard

Checks tool calls against tagged allow/deny/ask rules. Anything unmatched asks the user for approval. Owns the enforcement context (modes, approvals, cwd override) and coordinates with `pi-tools` (`fd`/`rg`, `/cd`), `pi-budgets` (`/budget`), and `pi-autopilot` (`autopilot` mode) through the event envelopes documented in `@hollowheap/core`'s README.

## Try it

```bash
pi -e ./packages/pi-guard
```

## Install

```bash
pi install npm:@hollowheap/pi-guard
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

Pi ships `find`, `grep`, and `ls` in core but they are opt-in — default sessions only have `read`, `bash`, `edit`, `write` active. The companion `pi-tools` package provides always-available `fd`/`rg` search tools that enforce the same rules.

Denied calls return `{ block: true, reason }`. Unmatched calls ask via a confirmation dialog, and anything else unknown (custom and MCP tools included) asks too. Without dialog-capable UI the ask becomes a block.

## Bash allowlist

Bash runs only when every part of the command matches an allow rule; parts without one ask for per-call approval in `ask`, and are blocked outright in `edit` and `plan`:

```json
{
  "rules": [
    "allow shell git status",
    "allow shell rg",
    "allow shell ls"
  ]
}
```

Each rule names a command plus an optional argument prefix (`allow shell git status` permits `git status --short` but not `git log`). Commands chained with `&&`, `||`, `;`, or `|` are split and every part needs its own allow rule. A part with no matching rule asks for per-call approval, and a part is always blocked when it uses `sh`, `bash`, `zsh`, `eval`, `xargs`, `env`, `sudo`, `tee`, or `dd` (even if allowed), contains a redirect (`>`, `>>`), or contains `$(` or backticks. Allowed commands run without asking. Bash output over 4000 characters is cut to the first 3000 and last 1000 with a cut count line. File paths are never checked for shell commands — the allowlist is the only gate, and it covers `bash` and `powershell` alike.

## Modes

`/mode [name]` shows or switches the plan/approval level. Modes live in session state only, never on disk; every session starts in `ask`. Unknown values are rejected with the registered names. Mode names autocomplete, and `alt+m` cycles the registered modes in order. `pi-guard` registers `plan`, `ask`, and `edit`; installing `pi-autopilot` adds `autopilot`.

Outcome matrix — rows are the rules verdict (or tool class), columns the mode. `run` executes silently, `prompt` asks once via dialog, `block` denies:

| call | `ask` | `edit` | `autopilot` | `plan` |
|---|---|---|---|---|
| edit allow, normal path | run | run | run | block |
| edit allow, plan file | prompt | prompt | prompt | prompt |
| edit no rule, normal path | prompt | run | run | block |
| edit no rule, plan file | prompt | prompt | prompt | prompt |
| edit deny | block | block | block | block |
| shell allowlisted | run | run | run | run |
| shell otherwise | prompt | block | run | block |
| read/search allow | run | run | run | run |
| read/search no rule | prompt | run | run | prompt |
| read/search deny | block | block | block | block |
| unknown tool | prompt | prompt | prompt | prompt |
| prompt without UI | block | block | block | block |

Modes govern shell too: `edit` runs only allowlisted commands without asking, and `plan` blocks anything else. Hard denies (dangerous names, redirects, command substitution, `deny` rules) block the whole command in every mode, including `autopilot`.

Deny beats every mode: a denied call never runs and never asks. Entering `plan` appends `allow edit` rules for the plan files in memory only (removed on exit), so planning works under deny-heavy configs. Writes to the plan files (`artifacts/plan.md`, `artifacts/specs.md`, and anything under `artifacts/tasks/`) always ask, in every mode — accepting a plan is the approval dialog itself, and a rejection is never written anywhere. The `autopilot` column applies when `pi-autopilot` is installed: switching to it without a token cap is refused, and turning it on shows a chat warning.

Without a rules file (or with an unreadable one) the extension warns once and asks for approval on every gated call, so fresh projects keep working with oversight until rules are written.

## Statusline values

This package publishes `mode-guard` (current mode) for statusline extensions over pi's shared event bus, following the protocol in `pi-statusline`'s README. (`pi-budgets` publishes `budgets` the same way.) No imports cross between the packages in either direction.
