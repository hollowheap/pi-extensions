# pi-extensions

[![Node.js](https://img.shields.io/badge/node-%3E%3D22.19.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tested with Vitest](https://img.shields.io/badge/tested%20with-vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

A modular powerpack of extensions for the [Pi coding agent](https://pi.dev).

Every package here is completely plug-and-play. You can grab individual packages directly from npm, install the entire suite in one shot from git, or fork this repo and start building your own custom setup!

---

## Packages

| Package | Version | Description |
| :--- | :--- | :--- |
| [`@hollowheap/core`](./packages/core) | `0.2.0` | Shared contracts, rules, budgets, and mode-registry primitives |
| [`@hollowheap/process`](./packages/process) | `0.2.0` | Detached process, atomic state, and JSONL Unix-socket primitives |
| [`@hollowheap/pi-statusline`](./extensions/pi-statusline) | `0.2.0` | Configurable lualine-style statusline footer |
| [`@hollowheap/pi-guard`](./extensions/pi-guard) | `0.2.0` | Policy enforcement, approvals, shell safety gates, and modes |
| [`@hollowheap/pi-hooks`](./extensions/pi-hooks) | `0.2.0` | Session-start, pre-tool, and post-tool commands configured in `hooks.json` |
| [`@hollowheap/pi-dashboard`](./extensions/pi-dashboard) | `0.2.0` | Interactive startup dashboard with ASCII banners and widgets |
| [`@hollowheap/pi-budgets`](./extensions/pi-budgets) | `0.2.0` | Token usage tracking, `/budget` controls, and hard-cap gates |
| [`@hollowheap/pi-autopilot`](./extensions/pi-autopilot) | `0.2.0` | Hands-free autopilot mode for autonomous workflow loops |
| [`@hollowheap/pi-tools`](./extensions/pi-tools) | `0.2.0` | High-speed ripgrep/fd search tools and `/cd` navigation |
| [`@hollowheap/pi-code-intel`](./extensions/pi-code-intel) | `0.2.0` | Read-only LSP code intelligence via a direct `code_intel` tool |
| [`@hollowheap/pi-question`](./extensions/pi-question) | `0.2.0` | Single-question prompt tool for guided user input |
| [`@hollowheap/pi-todos`](./extensions/pi-todos) | `0.2.0` | Tool-free todo blocks with branch-local state and `/todos` |
| [`@hollowheap/pi-tasks`](./extensions/pi-tasks) | `0.2.0` | Durable background shell tasks via a direct `task` tool |
| [`@hollowheap/pi-subagents`](./extensions/pi-subagents) | `0.2.0` | Durable child agents with live reattach, write locking, and explicit resume |
| [`@hollowheap/pi-classifier`](./extensions/pi-classifier) | `0.2.0` | Advisory classifier tool with structured `decide` calls |
| [`@hollowheap/pi-web`](./extensions/pi-web) | `0.2.0` | Direct `web_search` and `web_fetch` tools for current docs and web results |
| [`@hollowheap/pi-usage`](./extensions/pi-usage) | `0.2.0` | Session custom entry persistence (`hollowheap.usage`) and compaction-safe cumulative tracking |
| [`@hollowheap/pi-acp`](./packages/pi-acp) | `0.2.0` | ACP adapter server plus bundled pi extension (needs `npx tsc -p packages/pi-acp` to build) |

---

## Quick Install

### Grab everything at once
Install the entire suite directly into Pi:

```bash
pi install git:github.com/hollowheap/pi-extensions
```

The git suite installs each extension from `extensions/pi-<name>/`; startup labels stay short because Pi strips the `extensions/` prefix. Install individual npm packages below when you want to enable or disable extensions separately.

### Pick and choose individual packages
Want only the statusline or the safety guardrails? Install them separately from npm:

```bash
pi install npm:@hollowheap/pi-statusline
pi install npm:@hollowheap/pi-guard
```

### Manage your installed extensions
```bash
pi list
pi update --extensions
pi remove <package-name>
```

---

## Development

Pi runs TypeScript directly via jiti, so there is no build step needed while hacking on extensions.

### Prerequisites
- Node.js >= 22.19.0
- npm 10+

### Setup & Verification
```bash
npm install
npm test            # run vitest suite
npm run typecheck   # run tsc --noEmit
npm run lint        # check code with biome
```

### Test-drive an extension locally
You can load any local extension into a live Pi session without installing it:

```bash
pi -e ./extensions/pi-statusline
```

### Scaffold a brand new extension
Want to add another tool or extension to the monorepo? Use the built-in generator:

```bash
npm run new -- pi-<name>
```

This sets up `extensions/pi-<name>`, configures the package manifest, wires up tests, and registers the entrypoint in the root `package.json`.

---

## Writing Extensions

Every extension exports a default factory function that receives the `ExtensionAPI`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("hello", {
    description: "Say hello from a custom command",
    handler: async (name, ctx) => {
      ctx.ui.notify(`Hello, ${name || "friend"}!`, "info");
    },
  });
}
```

### Architectural Ground Rules
- Keep extensions modular: extensions never import each other's `src`. Shared primitives belong in `@hollowheap/core`.
- Host dependencies (`@earendil-works/pi-*`, `typebox`) must stay in `peerDependencies: "*"` and should never be bundled.
- Coordinate across extensions using synchronous mutable envelopes dispatched over `pi.events`.

---

## Publishing

Publishing is workspace-aware under the `@hollowheap` npm scope:

```bash
npm version --workspace @hollowheap/pi-statusline <patch|minor|major>
npm publish --workspace @hollowheap/pi-statusline --access public
```

---

## Docs & Resources

- Pi Extensions Documentation: <https://pi.dev/docs/latest/extensions>
- Pi Packages Documentation: <https://pi.dev/docs/latest/packages>

---

## License

This repository is licensed under the [MIT License](LICENSE). Fork it, build on it, and adapt it however you like!
