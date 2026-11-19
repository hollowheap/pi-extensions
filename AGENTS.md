# pi-extensions

Pi coding agent extension monorepo delivering guardrails, statusline, budgeting, dashboard, modal editing, hooks, tasks, subagents, web/LSP tools, memory, and an ACP server.

## Essential Commands

- Install dependencies: `npm install`
- Typecheck & ACP build: `npm run typecheck` (`npx tsc -p packages/acp` rebuilds gitignored `packages/acp/dist`)
- Lint: `npm run lint` (`npm run lint:fix` writes fixes)
- Full test suite: `npm test`
- Single test / module: `npx vitest run <file-or-dir>`
- Scaffold extension: `npm run new -- pi-<name>` (never hand-copy manifests)

## Conventions

- Extensions live in `extensions/pi-*` (`index.ts` re-exports `src/index.ts`); shared libraries live in `packages/` and `extensions/pi-ui`.
- Tests live in sibling `test/` directories for extensions and packages.
- Extensions import `@hollowheap/core/*` and `@hollowheap/runtime/*` subpaths (never barrel `@hollowheap/core`); host modules stay peer-only.
- Check host exports (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `ExtensionAPI.exec`, tool `annotations`) before adding local helpers in extensions or UI packages; keep `packages/core` and `packages/runtime` strictly host-free.
- Guard untrusted boundaries when using host helpers (`parseFrontmatter` throws on invalid YAML; `contentText` assumes valid `Content` objects) and guard dynamic object lookups with `Object.hasOwn` or `Object.create(null)`.
- Reuse `@hollowheap/core/*` (`scope`, `config`, `state`, `format`, `sandbox-config`, `alerts`, `workspace`, `statusline`, `policy`), `@hollowheap/runtime/*`, `@hollowheap/tui/*`, and `@hollowheap/pi-ui/*` before duplicating wrappers, path scoping, branch scans, or settings/completion boilerplate.
- Never vendor policy, modes, or shell analysis outside `@hollowheap/core`; commits are GPG-signed (never bypass hooks or signing).
- In tests, clean `process.env` with `Reflect.deleteProperty` (`delete` triggers Biome lint); sanitize untrusted outputs with `sanitizeTerminalText` at terminal UI/error boundaries.
- Extension skills stay opt-in via env flags (e.g. `PI_HOOKS_DISCOVER_SKILL=1`) to prevent prompt bloat.
- Verify narrow slices (`npx vitest run <file>`) before running full workspace checks.
