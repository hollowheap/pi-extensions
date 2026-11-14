# Review — pi-dashboard (V04)

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

- `index.ts:10` — `DashboardDeps` (`run`, `notify`) injection seam.
- `index.ts:19` — `DashboardController` (`lines`, `refresh`, `start`, `stop`).
- `index.ts:123` — `createDashboard(config, deps)` reusable controller factory.
- `config.ts:6` / `:17` — `DashboardSection`, `DashboardConfig`.
- `config.ts:144` / `:192` — `normalizeConfig`, `loadConfig`.
- `exec.ts:3` — `runCommand`.
- `render.ts:3` / `:20` — `fitLines`, `splitOutput`.

### Robustness Issues

- `index.ts:114-119` — `stop()` sets `stopped = true` but never resets; later `start()` re-arms interval while retries disabled.
- `index.ts:70-99` — success path does not check `controller.signal.aborted`; if `stop()` aborts after command resolves, section state still updates.
- `index.ts:90-93` — retry `setTimeout` handles not tracked/cleared; only `stopped` flag guards them.
- `index.ts:71` — no guard against hung `deps.run`; `running` can stay true indefinitely.
- `config.ts:198-203` — all read failures treated as missing file with no diagnostic.
- `index.ts:159-160` / `:189` — `active?.stop()` fire-and-forget; second `session_start` can replace `active` before cleanup finishes.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `index.ts:26-49` — `SectionController` plus `headerSection()` factory for a static section. | R12, R57, D22 | **Required, not overengineering.** R12/D22 require the dashboard to render multiple sections with dynamic width and stop/refresh behavior. The common controller is what lets header and terminal sections share one render loop; `headerSection` supplies the required no-op lifecycle. |
| `index.ts:86-93` — fixed retry/backoff policy inside the UI header component. | R57, D129 | **Required, not overengineering.** R57/D129 explicitly require failed sections to retry with backoff. The policy is the requirement. |
| `config.ts:49-142` — large per-field normalization/validation surface for the small config shape. | R12, R57 | **Required, not overengineering.** The dashboard accepts user `dashboard.json` with header and terminal sections; rejecting malformed commands, intervals, aliases, and gaps is the config contract. No requirement asks for a looser parser. |

### Resolution (2026-10-30)

- Terminal polling cannot restart after `stop()`; stopped controllers ignore `start()`.
- Retry timers are tracked and cleared on stop/success.
- Aborted or stopped successes no longer overwrite section state or request a render.
- `dashboard.json` read failures other than `ENOENT` now produce a diagnostic.
- The dashboard still replaces Pi's built-in startup header. A `version` section restores the running version line; key hints and logo interaction remain unavailable. Loaded-resource details render in Pi's separate startup container and are not removed by the header replacement.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
