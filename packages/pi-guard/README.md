# pi-guard

Checks tool calls against tagged allow/ask/deny rules and the active mode. Anything that resolves to `ask` prompts the user; `deny` blocks the call. Owns the TUI side of the policy: approval prompts, `/mode`, `alt+m`, and the `mode-guard` statusline value. Verdicts come from `@hollowheap/core`, so the ACP extension enforces exactly the same rules.

## Try it

```bash
pi -e ./packages/pi-guard
```

## Install

```bash
pi install npm:@hollowheap/pi-guard
```

## Rules

Rules live in `<agentDir>/permissions.json` (default `~/.pi/agent/permissions.json`):

```json
{
  "rules": [
    "deny edit *",
    "allow edit artifacts/specs/*.md",
    "ask shell git push"
  ]
}
```

Each rule is `"effect tag pattern"` or `{ "effect", "tag", "pattern" }`. `effect` is `allow`, `ask`, or `deny`; `tag` is `edit`, `read`, `search`, or `shell`.

A trusted project may add `<project>/.pi/permissions.json` as an overlay; untrusted projects are ignored (with a diagnostic) and the agent-dir rules still apply. The overlay is cached by mtime, so edits are picked up without a restart.

Patterns match the whole path relative to the workspace root. `*` spans directories and `?` matches one character, so `*` alone matches everything and `artifacts/specs/*.md` matches `artifacts/specs/a.md`. Every path resolves against the workspace root first, following symlinks; paths escaping the root (`../`, absolute paths elsewhere, symlinks pointing outside) are always denied.

Verdicts resolve in a fixed order, so the order of rules in the file never decides the outcome:

1. hard safety (path outside the root, empty command, dangerous interpreters, redirects, command or process substitution) → `deny`;
2. any matching `deny` rule → `deny`;
3. the active mode's restrictive overrides;
4. matching `allow`/`ask` rules by highest pattern specificity, ties toward the stricter effect;
5. the active mode's default for the tag.

With no rules at all the mode default decides: `ask` mode asks for edits and shell, `edit` mode allows edits, and reads and searches run.

## Hooked tools

| tool | tag | checked text |
|---|---|---|
| `write`, `edit` | `edit` | file path |
| `read` | `read` | file path |
| `find`, `grep`, `fd`, `rg`, `ls` | `search` | search root path |
| `bash`, `powershell` | `shell` | command name + argument prefix |

Unknown tools, including custom and MCP tools, ask by default. Add tags in `permissions.json` to classify them:

```json
{
  "tools": {
    "mcp__docs__search": "search",
    "mcp__docs__read": "read",
    "mcp__jira__create_issue": "edit"
  },
  "rules": [
    "allow search *",
    "allow read *"
  ]
}
```

User tags apply only to tools without a built-in tag; built-in mappings cannot be overridden. Invalid tags are diagnosed and ignored. A trusted project overlay can add tags to its own tools.

Denied calls return `{ block: true, reason }`. Calls that resolve to `ask` open a confirmation dialog. Without dialog-capable UI the ask becomes a block.

## Shell allowlist

Shell rules match command prefixes on token boundaries: `allow shell git` permits `git status` but never `github-cli`, and `allow shell git status` permits `git status --short` but not `git statusx`.

```json
{
  "rules": [
    "allow shell git status",
    "allow shell rg",
    "allow shell ls"
  ]
}
```

Chains split on newlines, `&`, `&&`, `||`, `;`, and `|`; every part is analysed on its own and the strictest part decides. A part without a matching rule asks for per-call approval. These are always denied, even with an allow rule: `sh`, `bash`, `zsh`, `dash`, `fish`, `eval`, `xargs`, `env`, `sudo`, `tee`, `dd`, `awk`, `perl`, `python`, `node`, output or input redirects, command substitution (`$(...)` or backticks), and process substitution (`<(...)`, `>(...)`). Bash output over 4000 characters is cut to the first 3000 and the last 1000 with a cut-count line.

## Modes

`/mode [name]` shows or switches the mode; mode names autocomplete and `alt+m` cycles the registered modes. Core registers `ask`, `edit`, and `plan`; installing `pi-autopilot` adds `autopilot`; `<agentDir>/modes.json` can add custom layers:

```json
{
  "modes": {
    "readonly": {
      "defaults": { "read": "allow", "search": "allow", "edit": "deny", "shell": "deny" },
      "overrides": [{ "tag": "edit", "pattern": "docs/**", "effect": "ask" }]
    }
  }
}
```

`defaults` must cover all four tags, overrides accept only `ask`/`deny`, and names that collide with a built-in or package mode are rejected with a diagnostic.

Defaults per mode:

| mode | read | search | edit | shell |
|---|---|---|---|---|
| `ask` (default) | allow | allow | ask | ask |
| `edit` | allow | allow | allow | ask |
| `plan` | allow | allow | deny | ask |
| `autopilot` | allow | allow | allow | allow |

`plan` additionally asks for edits to `artifacts/plan.md`, `artifacts/specs.md`, and anything under `artifacts/tasks/` (resolved against the effective working directory) and denies other edits. A `deny` rule still wins over the mode.

The active mode is persisted in the session file as the custom entry `hollowheap.core.mode`, so `session resume` and `session fork` keep it. A restored mode that no longer exists falls back to `ask` with a diagnostic, and restoring re-runs the entry gates — entering `autopilot` without a token cap is refused and falls back to `ask`.

## Statusline values

This package publishes `mode-guard` (the current mode) for statusline extensions over pi's shared event bus, following the protocol in `pi-statusline`'s README. (`pi-budgets` publishes `budgets` the same way.) No imports cross between the packages in either direction.
