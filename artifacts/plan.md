# Plan

## Standing decisions

- Keep the `@my-scope` npm placeholder until publishing. At publish time: claim a real scope, rename package names, update README install lines.
- `pi-statusline` reads `~/.pi/agent/statusline.json`, managed by home-manager.
- Formatter: 2-space indent (biome). `npm run new` scaffolds lint-clean packages.
- `pi-mode-guard` rules use tags (`edit`, `read`, `search`, `shell`); unmatched calls ask the user, unknown tools included. No default allow rules.
- `pi-mode-guard` shell gate (bash and powershell): allowlist rules (`allow bash <name> [prefix]`, chains split, hard-deny names/redirects/substitution); per-call approvals deferred to prompt 7.
- Plan mode constrains writes to `artifacts/plan.md` + `artifacts/specs.md` (artifacts skill; no `plans/` or `tasks/` dirs).
- `/budget` sets the session token cap (autopilot gate); totals accumulate from `message_end` usage, over-cap aborts the next run.
- Statusline extension layer runs over `pi.events` (`statusline:values` / `statusline:request`); providers `mode-guard` and `budgets`, no cross-package imports.

## Open work

- Publish: claim scope, then `npm publish --workspace <pkg> --access public` per package.

## Backlog (bottom)

- Package split (deferred per YAGNI): slim guard core exposing a mode API, with `pi-modes`, `pi-budgets`, and `pi-autopilot` extending it. Budget and cap stay internal but packaged as a shared library so custom limits can build on them. Verdict extension via mutable-envelope events; no cross-package imports.
- `pi-tools` candidate home for `fd`, `rg`, and maybe `/cd` (placement undecided, see TODO in `pi-mode-guard`).
- Custom budget limits on top of the shared budget/cap API, e.g. a daily limit counted in dollars instead of tokens (`usage.cost` is already reported per response).
