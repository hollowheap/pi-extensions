# Plan

## Standing decisions

- Keep the `@my-scope` npm placeholder until publishing. At publish time: claim a real scope, rename package names, update README install lines.
- `pi-statusline` reads `~/.pi/agent/statusline.json`, managed by home-manager.
- Formatter: 2-space indent (biome). `npm run new` scaffolds lint-clean packages.

## Open work

- `pi-permissions` bash coverage: model-issued bash arrives via `tool_call` (blockable) but the command is an opaque shell string that cannot be parsed reliably; `user_bash` covers only user-typed `!` commands and has no block result. Options: heuristic pattern blocking, opt-in approval prompts, OS sandbox. Undecided.
- `pi-permissions` MCP coverage: `mcp__*` tools pass through unmatched. Needs a per-server policy table in `permissions.json`. Undecided.
- Publish: claim scope, then `npm publish --workspace <pkg> --access public` per package.
