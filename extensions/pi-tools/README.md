# pi-tools

`/cd` workspace control for the Pi coding agent. This package registers no
model tools.

## Try it

```bash
pi -e ./extensions/pi-tools
```

## /cd

`/cd <path>` changes the effective working directory for file tools. The path
must be an existing directory inside the project root and pass
`check(rules, path, "read")`; otherwise an error is shown and the directory is
unchanged. The project root never changes. Bare `/cd` resets to the project
root. Directory names autocomplete against the active working directory and
omit directories outside the project root or denied by rules.

Pi exposes no API to move the session directory, so `pi-guard` rewrites relative
`path` arguments to the new directory before the rules verdict; `/cd` changes
`read`, `write`, and `edit` only when `pi-guard` is loaded. Absolute paths
are unaffected. The new directory is shown via `setStatus("cwd", …)` plus a
one-line notification.

## Search tools

`fd` and `rg` were removed on 2026-10-30. Built-in `grep` and `find` are also
excluded in the active setup. Use `bash` with `rg`, `fd`, and `ls` for search
and discovery. No `pi-tools.json` configuration remains.
