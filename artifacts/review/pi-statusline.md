# pi-statusline Review

## Public Seams

- Event bus protocol: providers emit `statusline:values` and answer `statusline:request`.
- Deep imports: `config.ts` (`StatuslineConfig`, `ComponentSpec`, `defaultConfig`, `loadConfig`, `normalizeConfig`, `normalizeComponentStyle`, `normalizeSeparator`), `components.ts` (`BUILTINS`, `ComponentFn`, `ComponentContext`, `GitDiffCache`, `createGitDiffCache`, `defaultGitRunner`, `formatCount`, `formatClock`, `shortenPath`, `clockIntervalMs`, `parseGitPorcelain`), `colors.ts` (`parseColorSpec`, `styleText`, `styleComponent`), `render.ts` (`renderStatusline`, `applySeparator`).
- Extension component allowlist: `DEFAULT_EXTENSIONS` and `extensions` field controls named providers.

## Robustness Issues

- `index.ts:87-94` — values arriving before footer installation are stored but no render triggered.
- `index.ts:76-85` — `values` never cleared on `session_start`; stale provider values from previous session persist.
- `index.ts:114-124` — footer reinstallation recreates `diffCache` but does not cancel inflight refreshes from previous cache.
- `index.ts:222-225` — `model_select` updates `currentModel` without checking `owner`, unlike other handlers.
- `components.ts:258-271` — `createGitDiffCache.refresh` does not wrap synchronously throwing runner; `inflight` stays populated.
- `components.ts:259` — if runner never settles, `inflight` remains and refreshes for that cwd permanently blocked.
- `components.ts:276-277` — `get` triggers async refresh when stale but returns previous (possibly undefined) summary.
- `config.ts:388-392` — all-empty `sections` object silently replaced with defaults.
- `config.ts:325-345` — `extensions` processed before `sections`; ordering subtle but works.

## Overengineering

- `colors.ts:9-28` and `:77-137` — large duplicated theme-token lists and starship color tables.
- `colors.ts:110-157` — `styleComponent` powerline pill rendering with caps/icons.
- `config.ts:139-262` — `resolveColor`, `normalizeSeparator`, `normalizeComponentStyle` plus `STYLE_KEYS` form heavy normalization pipeline.
- `components.ts:238-284` — `GitDiffCache` with inflight tracking, abort timers, TTL.