# pi-dashboard Review

## Public Seams

- `index.ts:10` — `DashboardDeps` (`run`, `notify`) injection seam.
- `index.ts:19` — `DashboardController` (`lines`, `refresh`, `start`, `stop`).
- `index.ts:123` — `createDashboard(config, deps)` reusable controller factory.
- `config.ts:6` / `:17` — `DashboardSection`, `DashboardConfig`.
- `config.ts:144` / `:192` — `normalizeConfig`, `loadConfig`.
- `exec.ts:3` — `runCommand`.
- `render.ts:3` / `:20` — `fitLines`, `splitOutput`.

## Robustness Issues

- `index.ts:114-119` — `stop()` sets `stopped = true` but never resets; later `start()` re-arms interval while retries disabled.
- `index.ts:70-99` — success path does not check `controller.signal.aborted`; if `stop()` aborts after command resolves, section state still updates.
- `index.ts:90-93` — retry `setTimeout` handles not tracked/cleared; only `stopped` flag guards them.
- `index.ts:71` — no guard against hung `deps.run`; `running` can stay true indefinitely.
- `config.ts:198-203` — all read failures treated as missing file with no diagnostic.
- `index.ts:159-160` / `:189` — `active?.stop()` fire-and-forget; second `session_start` can replace `active` before cleanup finishes.

## Overengineering

- `index.ts:26-49` — `SectionController` plus `headerSection()` factory for trivial static section.
- `index.ts:86-93` — fixed retry/backoff policy inside UI header component.
- `config.ts:49-142` — very large per-field normalization/validation surface for small config shape.