# pi-tools

Permission-enforcing `fd` and `rg` search tools plus `/cd` for the Pi coding agent. The working-directory override and the rule checks live in `@hollowheap/core`, so this package works with or without `pi-guard` installed: `/cd` stores the directory in the core session state, and search results are filtered by the core verdict (only `deny` drops a result — an `ask` result is kept).

## Tool exposure

`fd` and `rg` default to `direct`, so the model sees them in the declared tool schema. Set exposure per tool in `<agentDir>/pi-tools.json`:

```json
{
  "fd": "direct",
  "rg": "codemode"
}
```

Values are `direct`, `codemode`, and `hidden`; missing values default to `direct`. `codemode` keeps the tool script-callable without declaring it, and `hidden` skips registration. When either tool is `codemode`, `pi-tools` activates `codemode` on `session_start` if it is available and inactive.

Keep `tool_search` disabled while using `codemode` exposure. It searches `codemode` tools too, so a search can activate `fd`/`rg` and change the declared tool set mid-session.

## Try it

```bash
pi -e ./extensions/pi-tools
```

## Install

```bash
pi install npm:@hollowheap/pi-tools
```

## /cd

`/cd <path>` changes the working directory for file tools. The path must be an existing directory inside the project root and pass `check(rules, path, "read")`; otherwise an error is shown and the directory is unchanged. The project root never changes. Bare `/cd` resets to the project root. Directory names autocomplete best-effort against the launch directory.

Pi exposes no API to move the session directory, so `pi-guard` rewrites relative `path` arguments to the new directory before the rules verdict. Absolute paths are unaffected. The new directory is shown via `setStatus("cwd", …)` for status lines that render extension statuses, plus a one-line notification.

## Built-in tools

- `fd` — `pattern` (glob, required), `path` (optional, defaults to working directory), `max_results` (1–500, default 100). Runs the `fd` binary with `--glob`, keeps only explicitly allowed paths, returns paths relative to the working directory (the `/cd` directory when set) newest first.
- `rg` — `pattern` (regex, required), `path` (optional, directory or file), `glob` (optional file filter), `max_results` (1–500, default 100). Runs the `rg` binary, keeps only matches from explicitly allowed files, returns `path:line:text` lines cut to 300 characters, paths relative to the working directory (the `/cd` directory when set).

Both run their binary with an argument array and no shell, and fail with a clear error when the binary is not installed. The `tool_call` hook still gates their search root first; per-result filtering applies on top, so usable searches need `allow search` rules.
