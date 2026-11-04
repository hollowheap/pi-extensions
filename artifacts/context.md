# Context

## Stack & Entrypoints

- Node >= 22.19, npm workspaces (`packages/*`, `extensions/*`), TypeScript via jiti (`noEmit`), vitest, biome.
- Extensions: `extensions/pi-<name>/index.ts` re-exports `src/index.ts`; entry declared in `pi.extensions`.
- `packages/core` (`@hollowheap/core`): shared policy, config, shell/exec, formatting, modes, and session/mode registry.
- `packages/process` (`@hollowheap/process`): detached process, atomic state, and JSONL Unix-socket primitives.
- `packages/tui` (`@hollowheap/tui`): shared frames, pickers, pagers, progress, and code viewer.
- `packages/pi-acp`: standalone ACP server (`src/main.ts`) plus a bundled extension (`src/extension/`) spawned as `pi --mode rpc -ne -e <ext> -nbt`.
- Host loader: jiti per extension, `moduleCache: false`; installed packages get separate module roots, so shared state uses the core global registry.
- ACP live smoke needs an ACP client and a model; not runnable in-repo.

## Module Seams

See `artifacts/architecture.md#module-seams`.
