# Review — pi-tools (V14)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`

Status (2026-10-30): `fd`/`rg` removed in favor of `bash` search. `pi-tools`
is now `/cd` only. The earlier containment, config, parsing, and `ExecDeps`
findings remain historical.


## Requirements Review

N/A — package robustness review; traceability is recorded in the Code Review findings.

## Design Review

N/A — package robustness review; see `artifacts/architecture.md`.

## Specification Review

N/A — package robustness review; verify commands are recorded under Code Review.

## Plan Review

N/A — package robustness review; tasks remain in `artifacts/plan.md`.

## Code Review

### Public Seams

- `index.ts:60` — default extension entry; registers only the `/cd` command and
  uses `session_start` for completion context.
- `permissions.ts:7` — `loadContextPermissions(ctx)` adapter for core rules.

The `fd`/`rg` tool, `pi-tools.json`, `ExecDeps`, and rg parser seams were removed
with the direct search tools.

### Robustness Issues

- `fd.ts:38-57` — `searchDir` not contained to `effective`/project root; `relative(effective, searchDir)` can become `../..`; `statMtimeMs` at `:52` runs before `checkPath` at `:55`, leaking existence/mtime of denied paths.
- `rg.ts:65-68` — `target`/`searchDir` not validated against `effective`/root before invoking `rg`; scan can escape project root.
- `rg.ts:90` — `resolve(searchDir, parsed.path)` assumes rg output is relative; absolute or `..`-containing output could bypass containment.
- `rg.ts:19-23` — `isFileTarget` treats any `statSync` failure (including permission errors) as "not a file".
- `rg.ts:27` — `RG_LINE` greedy `.*` can misparse paths containing colon-digit sequences.
- `index.ts:11-28` — `completeCd` resolves directories relative to `process.cwd()`, not project root; lists denied directories without permission filtering.
- `index.ts:79-83` — outside-root guard checks `rel.startsWith(".."+sep)` plus exact `".."`; platform/path-separator fragile.
- `config.ts:43-52` — unreadable config file silently treated as missing, no diagnostic.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `exec.ts:14-25` — `ExecDeps` mainly injects test doubles. | No R/D | **Fixed.** Removed; `createFdTool`/`createRgTool` take only exposure by default, and tests mock `./exec.js`. |
| `permissions.ts:1-14` — one-function wrapper around core `loadPermissions`. | R10, D14 | **Required, not overengineering.** R10/D14 require `pi-tools` to delegate policy to core while keeping its own UI/transport. This wrapper is the adapter that supplies agent dir, workspace, trust, and diagnostics. |
| `rg.ts:12-16` + `:26` — `RgMatch`/`parseRgLine` exported as a reusable parsing seam. | R16, D42 | **Fixed.** The parser and export were removed; `rg --json` is parsed internally. |
| `index.ts:41-55` — codemode auto-activation logic adds session-state coupling. | R16, D43 | **Required, not overengineering.** D43 explicitly requires `pi-tools` to activate the registered codemode tool on every `session_start`, including reload. The session coupling is the requirement. |

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — findings resolved.
