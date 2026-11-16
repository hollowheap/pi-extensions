# pi-extensions

Pi coding agent extension monorepo delivering guardrails, statusline, budgeting, dashboard, modal editing, hooks, tasks, subagents, web/LSP tools, memory, and an ACP server.

## Essential Commands

- Install dependencies: `npm install`
- Typecheck & ACP build: `npm run typecheck` (`npx tsc -p packages/acp` rebuilds gitignored `packages/acp/dist`)
- Lint: `npm run lint` (`npm run lint:fix` writes fixes)
- Full test suite: `npm test`
- Single test / module: `npx vitest run <file-or-dir>`
- Scaffold extension: `npm run new -- pi-<name>` (never hand-copy manifests)
- Artifact checks: `scripts/artifacts.sh status|check|verify-links|frontier`

## Conventions

- Extensions live in `extensions/pi-*` (`index.ts` re-exports `src/index.ts`); shared libraries live in `packages/`.
- Extensions import `@hollowheap/core/*` and `@hollowheap/runtime/*` subpaths (never barrel `@hollowheap/core`); host modules stay peer-only.
- Never vendor policy, modes, or shell analysis outside `@hollowheap/core`; commits are GPG-signed (never bypass hooks or signing).
- In tests, clean `process.env` with `Reflect.deleteProperty` (`delete` triggers Biome lint).
- Extension skills stay opt-in via env flags (e.g. `PI_HOOKS_DISCOVER_SKILL=1`) to prevent prompt bloat.
- Verify narrow slices (`npx vitest run <file>`) before running full workspace checks.
