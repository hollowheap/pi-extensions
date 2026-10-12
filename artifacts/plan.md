# Plan

## Standing decisions

- Keep the `@my-scope` npm placeholder until publishing. At publish time: claim a real scope, rename package names, update README install lines.
- `pi-statusline` reads `~/.pi/agent/statusline.json`, managed by home-manager.
- Formatter: 2-space indent (biome). `npm run new` scaffolds lint-clean packages.
- `pi-permissions` rules use tags (`edit`, `read`, `search`, `shell`); unmatched calls ask the user, unknown tools included. No default allow rules.
- `pi-permissions` shell rules match the raw command text; unmatched shell calls ask. Approval prompts are the bash gate — no separate mechanism planned.
- Plan mode constrains writes to `artifacts/plan.md` + `artifacts/specs.md` (artifacts skill; no `plans/` or `tasks/` dirs).

## Open work

- Publish: claim scope, then `npm publish --workspace <pkg> --access public` per package.
