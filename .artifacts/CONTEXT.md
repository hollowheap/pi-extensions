# Context

## Stack & Entrypoints

- Node >= 22.19, npm workspaces (`packages/*`, `extensions/*`), TypeScript loaded by jiti (`moduleCache: false`), vitest, biome.
- Extension entries: `extensions/pi-*/index.ts` re-exporting `src/index.ts`, declared under `pi.extensions` in `package.json`.
- Host loader gives each installed extension its own jiti module root; cross-extension live state uses `globalThis` registries in `@hollowheap/core`.
- ACP server entrypoint: `packages/pi-acp/src/main.ts` (`dist/` via `npx tsc -p packages/pi-acp`); spawns `pi --mode rpc -ne -e <ext> -nbt`.
- Live ACP smoke testing requires an external ACP client and model; not runnable inside repo tests.

## Module Seams

- **Core (`packages/core`)**: Owns policy evaluation, JSON config updates (`updateJsonConfig`), pricing, usage ledger, shell parsing, text sanitizing (`sanitizeTerminalText`), modes, prompt lock, session caches, branch state, and `@hollowheap/core/snapshot` live snapshot bus + branch summary reader.
- **Runtime (`packages/runtime`)**: Owns `bwrap` sandboxing, process-group kill, detached runners, atomic state, `LockedProcessStore`, and JSONL Unix-socket primitives.
- **TUI (`packages/tui`)**: Owns rounded frames (`roundedFrame`), fuzzy picker, pager, progress, and code viewer over `@earendil-works/pi-tui` peers.
- **Policy (`packages/policy`)**: Owns headless permission enforcement and shared tool-target helpers.
- **Pi-ACP (`packages/pi-acp`)**: Owns ACP JSON-RPC transport, session store, adapter routing, and bundled extension tools (`acp_*`); keeps subagents inactive.
- **Safety & Session Extensions (`pi-guard`, `pi-hooks`, `pi-tools`, `pi-usage`, `pi-agent`, `pi-autopilot`, `pi-memory`, `pi-decide`)**: Own interactive guardrails/UI/tracking while delegating policy, pricing, and cwd/usage persistence to `@hollowheap/core`; persist branch audit/usage/agent/memory/autopilot custom entries and publish live `SessionSnapshot` slices.
- **Workflow & Tool Extensions (`pi-question`, `pi-todos`, `pi-tasks`, `pi-subagents`, `pi-web`, `pi-language-tools`)**: Expose `ask_questions`, `create_todos`/`complete_todos`, `web_*`, `lang` (`codemode`), and direct `task`/`subagent` tools; persist run/history/todo custom entries and publish `SessionSnapshot` slices.
- **UI Shell Extensions (`pi-statusline`, `pi-dashboard`, `pi-modal`)**: Own footer statusline (git-repo `cwd` truncation, themes), auto-hiding startup/interactive `/dashboard` (`state`, `sessions`, `actions`, `terminal`), and Vim `ModalEditor`, `$` skill autocomplete, `/expand` persistence (`hollowheap.modal.expand`), and rounded code viewer.
