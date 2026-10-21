# pi-tools

Permission-enforcing `fd` and `rg` search tools plus `/cd` for the Pi coding agent. `pi-guard` owns the working-directory override and gates every call; this package drives both through the `guard:cwd-set` / `guard:cwd-query` envelopes, and vendors byte-identical copies of `pi-guard`'s `rules.ts`/`loader.ts` for result filtering (canonical copies live in `pi-guard` — edit those, then copy over).

## Try it

```bash
pi -e ./packages/pi-tools
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
