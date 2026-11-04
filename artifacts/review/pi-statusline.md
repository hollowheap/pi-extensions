# Review — pi-statusline (V10)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`


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

- Event bus protocol: providers emit `statusline:values` and answer `statusline:request`.
- Deep imports: `config.ts` (`StatuslineConfig`, `ComponentSpec`, `defaultConfig`, `loadConfig`, `normalizeConfig`, `normalizeComponentStyle`, `normalizeSeparator`), `components.ts` (`BUILTINS`, `ComponentFn`, `ComponentContext`, `GitDiffState`, `createGitDiffState`, `defaultGitRunner`, `formatCount`, `formatClock`, `shortenPath`, `clockIntervalMs`, `parseGitPorcelain`), `colors.ts` (`parseColorSpec`, `styleText`, `styleComponent`), `render.ts` (`renderStatusline`, `applySeparator`).
- Extension component allowlist: `DEFAULT_EXTENSIONS` and `extensions` field controls named providers.

### Robustness Issues

- `index.ts:87-94` — values arriving before footer installation are stored but no render triggered.
- `index.ts:76-85` — `values` never cleared on `session_start`; stale provider values from previous session persist.
- `index.ts:114-124` — footer reinstallation recreates `diffState`; `clear` invalidates late results from the previous state.
- `index.ts:222-225` — `model_select` updates `currentModel` without checking `owner`, unlike other handlers.
- Resolution (2026-11-04): `createGitDiffState.refresh` catches synchronously throwing runners and stores `undefined` on failure.
- Resolution (2026-11-04): a runner that never settles no longer blocks future refreshes because there is no in-flight slot.
- Resolution (2026-11-04): `get` returns only the stored summary; refresh is explicit from footer and session events.
- `config.ts:388-392` — all-empty `sections` object silently replaced with defaults.
- `config.ts:325-345` — `extensions` processed before `sections`; ordering subtle but works.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `colors.ts:9-28` and `:77-137` — large duplicated theme-token lists and starship color tables. | R12, D21 | **Required feature, duplicated data.** D21 requires the component/pill pipeline and theme-aware colors. The duplication is maintainability debt, not an unrequested abstraction. |
| `colors.ts:110-157` — `styleComponent` powerline pill rendering with caps/icons. | R12, D21 | **Required, not overengineering.** D21 explicitly defines the pill pipeline; caps and icons are its rendering contract. |
| `config.ts:139-262` — `resolveColor`, `normalizeSeparator`, `normalizeComponentStyle` plus `STYLE_KEYS` form heavy normalization pipeline. | R12, R59, D21, D131 | **Required, not overengineering.** Statusline config is user-facing and R59/D131 add custom components/click actions; normalization is how invalid color/style specs fail safely. |
| `components.ts:238-284` — `GitDiffCache` with inflight tracking, abort timers, TTL. | No R/D | **Fixed (2026-11-04).** The cache was replaced by `GitDiffState`, which stores the latest summary and refreshes only on explicit events; TTL, in-flight coalescing, and abort timers were removed. |

### Resolution (2026-10-30)

- Values that arrive before the footer factory runs render once the footer is installed.
- Provider values are cleared on `session_start`.
- Footer disposal clears the git-diff cache and aborts inflight refreshes.
- `model_select` ignores updates from a non-owning session.
- `GitDiffCache` catches synchronous runner throws, clears the slot before notifying, and races a hard timeout so a hung runner cannot block forever.
- `clear()` aborts inflight controllers and invalidates late results.
- `clickActions` now normalize; `/statusline click <segment>` executes configured slash actions or external commands via `pi.exec` and reports output/errors.
- Default click actions cover `mode` → `/mode`, `model` → `/model`, and `usage` → `/usage`.
- The `cwd` segment resolves the git repository root and renders `repo/relative/path` (or the repo name at the root), with `depth` still applying.
- `customComponentsPath` was removed from the live config until a loader contract exists; custom TS loading is tracked in `artifacts/plan.md` backlog.
- The git-diff cache remains package-local because it is UI refresh infrastructure, not shared policy.

### Resolution (2026-11-04)

- Replaced `GitDiffCache` with `GitDiffState`: no TTL, in-flight coalescing, abort timers, or stale-refresh getter.
- `refresh` stores the latest result; `clear` invalidates late results with a generation counter.
- Removed `options.gitIntervalMs` and the matching settings row; git refresh follows footer, branch, turn, and tool events.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — overengineering findings resolved.
