# pi-tools Review

## Public Seams

- `config.ts:4` — `ToolExposure` (`"direct" | "codemode" | "hidden"`)
- `config.ts:6` — `CONFIG_FILE_NAME`
- `config.ts:8` — `ToolsConfig`
- `config.ts:36` — `loadToolsConfig(agentDir, onDiagnostic?)`
- `exec.ts:4` — re-exported `RunOptions`
- `exec.ts:6` — `statMtimeMs`
- `exec.ts:14` — `ExecDeps`
- `exec.ts:25` — `defaultExecDeps`
- `rg.ts:12` — `RgMatch`
- `rg.ts:18` — `isFileTarget`
- `rg.ts:26` — `parseRgLine`
- `rg.ts:32` — `createRgTool(deps?, exposure?)`
- `rg.ts:112` — `rgTool`
- `fd.ts:9` — `createFdTool(deps?, exposure?)`
- `fd.ts:75` — `fdTool`
- `permissions.ts:7` — `loadContextPermissions(ctx)`
- `index.ts:30` — default extension entry

## Robustness Issues

- `fd.ts:38-57` — `searchDir` not contained to `effective`/project root; `relative(effective, searchDir)` can become `../..`; `statMtimeMs` at `:52` runs before `checkPath` at `:55`, leaking existence/mtime of denied paths.
- `rg.ts:65-68` — `target`/`searchDir` not validated against `effective`/root before invoking `rg`; scan can escape project root.
- `rg.ts:90` — `resolve(searchDir, parsed.path)` assumes rg output is relative; absolute or `..`-containing output could bypass containment.
- `rg.ts:19-23` — `isFileTarget` treats any `statSync` failure (including permission errors) as "not a file".
- `rg.ts:27` — `RG_LINE` greedy `.*` can misparse paths containing colon-digit sequences.
- `index.ts:11-28` — `completeCd` resolves directories relative to `process.cwd()`, not project root; lists denied directories without permission filtering.
- `index.ts:79-83` — outside-root guard checks `rel.startsWith(".."+sep)` plus exact `".."`; platform/path-separator fragile.
- `config.ts:43-52` — unreadable config file silently treated as missing, no diagnostic.

## Overengineering

- `exec.ts:14-25` — `ExecDeps` exists mainly to inject test doubles.
- `permissions.ts:1-14` — one-function wrapper around core `loadPermissions`.
- `rg.ts:12-16` + `:26` — `RgMatch`/`parseRgLine` exported as reusable parsing seam with limited independent value.
- `index.ts:41-55` — codemode auto-activation logic adds session-state coupling.