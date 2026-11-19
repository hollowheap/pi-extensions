# pi-tools

`/cd` workspace control and codemode utilities for the Pi coding agent.

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

## Codemode utilities

When loading this package on its own, enable Pi’s codemode tool with
`"+codemode"` in the `defaultTools` setting.

Use `batch` to run independent calls to the same tool without an explicit
`.map()` or `Promise.allSettled()`.

```js
const { results } = await tools.batch({
  tool: "read",
  args: [{ path: "README.md" }, { path: "package.json" }],
});
return results;
```

For different tools, use `{ calls: [{ tool, args }, ...] }`. Each call uses
Pi's normal tool validation, permissions, and hooks. Results follow input
order with an `ok`, `error`, or `cancelled` status. A batch accepts up to 32
calls and defaults to four at a time. Set `concurrency: 1` for serial execution.

`await tools.compact_context({ instructions: "Keep the verification results" })`
queues Pi's session compaction after the current run settles. Repeated
requests in that run share a single queue entry. Pi's compaction settings and
extension hooks govern how the summary is produced.
