# Tasks: package split (closed 2026-10-14)

Moved from artifacts/plan.md when the ACP adapter initiative started.

Objective: split `pi-mode-guard` into `@hollowheap/core` + `pi-guard` + `pi-tools` + `pi-budgets` + `pi-autopilot`; rename scope `@my-scope` to `@hollowheap`.

All tasks completed (see git history). Final verification at close: `npm run typecheck` clean, 236 tests passing, `npm run lint` clean, live `pi -p` starts with zero extension errors.
