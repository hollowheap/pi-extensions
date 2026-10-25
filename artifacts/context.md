# Context

## Stack & Entrypoints

- Node >= 22.19, npm workspaces (`packages/*`), TypeScript (`noEmit`, pi loads TS via jiti), vitest, biome.
- Extensions: `packages/pi-<name>/src/index.ts`, thin `export default (pi: ExtensionAPI)` factory, entry declared in `pi.extensions`. The root git suite exposes one composed entry, `src/index.ts`.
- `packages/core` (`@hollowheap/core`): shared runtime foundation. Owns policy, config, shell analysis, exec, formatting, and the session/mode registry.
- `packages/pi-acp`: standalone ACP server (`src/main.ts`) plus a bundled pi extension (`src/extension/`) spawned as `pi --mode rpc -ne -e <ext> -nbt` so built-ins cannot bypass ACP tools.
- Host loader: jiti per extension, `moduleCache: false`; resolves host modules, relative files, builtins, and installed package deps (so `@hollowheap/core` must be a real `dependencies` entry). Installed packages get separate module roots (`docs/packages.md:92`), so shared state needs the process-global registry.

## Commands

- `npm test` — vitest, 569 passed / 51 files (verified 2026-10-25).
- `npm run typecheck` — `tsc --noEmit`, clean (verified 2026-10-25).
- `npm run lint` — `biome check .`, 140 files clean (verified 2026-10-25).
- `npx tsc -p packages/pi-acp` — rebuild `dist/` (gitignored); run after pi-acp changes.
- `npm run new -- pi-<name>` — scaffold a package; never hand-copy manifests.
- ACP live smoke needs an ACP client (Neovim Avante) and a model; not runnable in-repo.

## Module Seams

- `core` → policy (rules, precedence), config (`.pi/permissions.json` cache), shell analysis, exec, formatting, session/mode registry.
- `pi-guard` → TUI enforcement: `tool_call` verdict via core, `ctx.ui.confirm` on ask, bash truncation, `/mode`, `alt+m`, `mode-guard` statusline value.
- `pi-hooks` → pre-tool and post-tool commands from `<agentDir>/hooks.json` (+ trusted project overlay); block/pass on `tool_call`, appended output on `tool_result`; ships the `hooks-init` skill via `resources_discover`.
- `pi-tools` → `fd`/`rg` tools default to direct exposure (configurable in `pi-tools.json`) and `/cd`; activates `codemode` only when configured; cwd and rule checks via core.
- `pi-code-intel` → `code_intel` defaults to direct exposure (configurable in `code-intel.json`), language-server pool, trust gate, and path checks; activates `codemode` only when configured.
- `pi-budgets` → token cap, usage accumulation, cap abort, autopilot entry gate.
- `pi-autopilot` → registers the `autopilot` mode layer.
- `pi-statusline` / `pi-dashboard` → footer/header renderers; extension segments and width handling.
- `pi-acp` adapter → ACP JSON-RPC framing, one pi child + per-session unix socket, session store, permission/fs/terminal client requests.
- `pi-acp` extension → `acp_read/write/edit/bash/fd/rg/eza`, socket bridge, core-based policy hook.

## Verification Discipline

- Every behavior change ships `src/*.test.ts`; run `npm test` + `npm run typecheck`; `npm run lint` before finishing.
- Do not commit without explicit request; signed commits (GPG) may require the desktop pinentry.
