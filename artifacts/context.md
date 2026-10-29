# Context

## Stack & Entrypoints

- Node >= 22.19, npm workspaces (`packages/*`, `extensions/*`), TypeScript via jiti (`noEmit`), vitest, biome.
- Extensions: `extensions/pi-<name>/index.ts` re-exports `src/index.ts`; entry declared in `pi.extensions`.
- `packages/core` (`@hollowheap/core`): shared policy, config, shell/exec, formatting, modes, and session/mode registry.
- `packages/process` (`@hollowheap/process`): detached process, atomic state, and JSONL Unix-socket primitives.
- `packages/pi-acp`: standalone ACP server (`src/main.ts`) plus a bundled extension (`src/extension/`) spawned as `pi --mode rpc -ne -e <ext> -nbt`.
- Host loader: jiti per extension, `moduleCache: false`; installed packages get separate module roots, so shared state uses the core global registry.

## Commands

- `npm test` — vitest, 832 passed / 86 files (verified 2026-10-29).
- `npm run typecheck` — `tsc --noEmit`, clean (verified 2026-10-29).
- `npm run lint` — `biome check .`, 250 files clean (verified 2026-10-29).
- `npx tsc -p packages/pi-acp` — rebuild gitignored `dist/`.
- `scripts/artifacts.sh status|next-tasks|verify-links` — inspect the R/D/S/T artifacts.
- `npm run new -- pi-<name>` — scaffold a package; never hand-copy manifests.
- ACP live smoke needs an ACP client and a model; not runnable in-repo.

## Module Seams

- `core` → policy, config cache, pricing resolution, shell analysis, exec/format, modes, session state, process-wide prompt queue.
- `pi-guard` → tool-call verdicts, approvals, bash truncation, `/mode`, `/context`, `alt+m`.
- `pi-hooks` → session-start, pre-tool, and post-tool commands from `hooks.json` plus a trusted project overlay; opt-in `hooks-init`.
- `pi-todos` → sticky widget rendering tagged todos with checkboxes and active tasks/subagent states.
- `pi-tools` → direct `fd`/`rg` by default (configurable exposure), `/cd`.
- `pi-code-intel` → direct `code_intel` by default (configurable exposure), LSP pool, trust and path checks.
- `pi-classifier` → advisory `decide` tool, explicit classifier config, caps, cache, and payload privacy.
- `@hollowheap/process` → detached lifecycle, atomic state, JSONL sockets, logs, cancellation, and PID/start-time reconciliation.
- `pi-web` → codemode `web_search`/`web_fetch`, normalized Tavily/Exa/Firecrawl adapters, clean markdown views, URL safety, capped output.
- `pi-tasks` → durable background shell tasks, direct `task` tool, PID/start-time reconciliation.
- `pi-subagents` → durable child RPC agents, model pre-flight check and interactive swap prompt (`ctx.ui.select`), write lock, and explicit resume.
- `pi-agent` → `/agent` command, user/project agent discovery, auto-forking with branch labels, skill filtering, modal popup, and system prompt injection.
- `pi-budgets` → token/dollar caps, model pricing resolution (free models at $0.00), usage accumulation, cap abort, autopilot gate.
- `pi-usage` → session custom entry persistence (`hollowheap.usage`), compaction-safe cumulative token/dollar tracking, `/usage` command.
- `pi-modal` → CustomEditor with Vim normal/insert/visual modes, mode badge, and `~/.pi/agent/modal.json` key overrides.
- `pi-autopilot` → `autopilot` mode layer.
- `pi-statusline` / `pi-dashboard` → footer/header renderers.
- `pi-acp` adapter → JSON-RPC framing, one pi child + per-session socket, session store, permission/fs/terminal requests.
- `pi-acp` extension → `acp_*` tools, socket bridge, core policy hook.
