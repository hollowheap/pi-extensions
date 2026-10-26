# Context

## Stack & Entrypoints

- Node >= 22.19, npm workspaces (`packages/*`, `extensions/*`), TypeScript via jiti (`noEmit`), vitest, biome.
- Extensions: `extensions/pi-<name>/index.ts` re-exports `src/index.ts`; entry declared in `pi.extensions`.
- `packages/core` (`@hollowheap/core`): shared policy, config, shell/exec, formatting, modes, and session/mode registry.
- `packages/pi-acp`: standalone ACP server (`src/main.ts`) plus a bundled extension (`src/extension/`) spawned as `pi --mode rpc -ne -e <ext> -nbt`.
- Host loader: jiti per extension, `moduleCache: false`; installed packages get separate module roots, so shared state uses the core global registry.

## Commands

- `npm test` — vitest, 640 passed / 61 files (verified 2026-10-26).
- `npm run typecheck` — `tsc --noEmit`, clean (verified 2026-10-26).
- `npm run lint` — `biome check .`, 179 files clean (verified 2026-10-26).
- `npx tsc -p packages/pi-acp` — rebuild gitignored `dist/`.
- `scripts/artifacts.sh status|next-tasks|verify-links` — inspect the R/D/S/T artifacts.
- `npm run new -- pi-<name>` — scaffold a package; never hand-copy manifests.
- ACP live smoke needs an ACP client and a model; not runnable in-repo.

## Module Seams

- `core` → policy, config cache, shell analysis, exec/format, modes, session state, process-wide prompt queue.
- `pi-guard` → tool-call verdicts, approvals, bash truncation, `/mode`, `alt+m`.
- `pi-hooks` → session-start, pre-tool, and post-tool commands from `hooks.json` plus a trusted project overlay; ships `hooks-init`.
- `pi-tools` → direct `fd`/`rg` by default (configurable exposure), `/cd`.
- `pi-code-intel` → direct `code_intel` by default (configurable exposure), LSP pool, trust and path checks.
- `pi-classifier` → advisory `decide` tool, explicit classifier config, caps, cache, and payload privacy.
- `pi-web` → direct `web_search`/`web_fetch` package seam plus normalized Tavily/Exa/Firecrawl provider adapters, key-based selection, and static fetch extraction.
- `pi-tasks` → durable background shell tasks, direct `task` tool, PID/start-time reconciliation.
- `pi-budgets` → token cap, usage accumulation, cap abort, autopilot gate.
- `pi-autopilot` → `autopilot` mode layer.
- `pi-statusline` / `pi-dashboard` → footer/header renderers.
- `pi-acp` adapter → JSON-RPC framing, one pi child + per-session socket, session store, permission/fs/terminal requests.
- `pi-acp` extension → `acp_*` tools, socket bridge, core policy hook.
