# AGENTS.md

Pi extension monorepo for the Pi coding agent. Node >= 22.19, npm workspaces, TypeScript loaded by jiti, vitest, biome. Extensions live in `extensions/pi-*`; shared runtime libraries live in `packages/`. Host modules are peer-only. Never vendor policy, modes, or shell analysis. Commits are GPG-signed; never bypass hooks or signing.

## Essential Commands

- `npm install` — install the workspace once at the root.
- `npm test` — vitest over `extensions/*/src/**` and `packages/*/src/**` (`npx vitest run <file>` for one file).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — `biome check .` (`npm run lint:fix` writes fixes).
- `npm run new -- pi-<name>` — scaffold a package; never hand-copy manifests.
- `npx tsc -p packages/pi-acp` — rebuild gitignored `packages/pi-acp/dist`.
- `scripts/artifacts.sh status|next-tasks|verify-links` — inspect the R/D/S/T artifacts.

## Repository Layout

- `extensions/pi-*/` — one extension per package, entry `index.ts` re-exporting `src/index.ts`.
- `packages/core/` — shared policy, config, shell/exec, formatting, modes, state.
- `packages/process/` — detached process, atomic state, and JSONL Unix-socket primitives.
- `packages/pi-acp/` — standalone ACP server plus bundled pi extension.
- `extensions/pi-hooks/src/skills/hooks-init/` — lifecycle-hooks skill.
- `artifacts/` — requirements, decisions, specs, plan, context.

## Conventions

- In tests, clean `process.env` with `Reflect.deleteProperty` (`delete` triggers Biome lint).
- Extension skills must be opt-in via env flags (e.g. `PI_HOOKS_DISCOVER_SKILL=1`) to prevent prompt bloat.
- Verify changes narrowly (`npx vitest run <file>`) before chaining compound checks.

## Architecture

See `artifacts/context.md` for entrypoints, commands, and module seams.
