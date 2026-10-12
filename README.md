# my-pi-extensions

Monorepo of [Pi coding agent](https://pi.dev) extensions. Each package in `packages/` is an independently installable Pi package; the repo root is also installable as one git package enabling everything.

## Layout

```text
packages/pi-statusline/   lualine-style configurable footer
packages/pi-mode-guard/   policy tags (edit/read/search/shell), ask-by-default approvals, modes, /cd, fd/rg
packages/pi-question/     one-question user prompt tool
  package.json         name, version, `keywords: ["pi-package"]`, `pi.extensions`
  src/index.ts         default export: (pi: ExtensionAPI) => { register Tools/Commands }
  src/index.test.ts    vitest coverage with a mocked ExtensionAPI
scripts/new-extension.mjs   scaffolds packages/pi-<name>
```

## Requirements

Node.js >= 22.19.0, npm 10+.

## Develop

```bash
npm install
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run lint        # biome check

# Load one extension for a single session (no install, no build — Pi runs TS via jiti):
pi -e ./packages/pi-statusline
```

## Add an extension

```bash
npm run new -- pi-<name>
```

Then edit `packages/pi-<name>/src/index.ts`, add tests, and append the entrypoint to the root `pi.extensions` (the script does this automatically).

Each extension module must default-export a factory receiving `ExtensionAPI`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("hello", {
    description: "Show a greeting",
    handler: async (name, ctx) => {
      ctx.ui.notify(`Hello, ${name || "world"}!`, "info");
    },
  });
}
```

Keep `src/index.ts` the single entrypoint declared in that package's `pi.extensions`.

## Publish (per package)

```bash
npm version --workspace @my-scope/pi-statusline <patch|minor|major>
npm publish --workspace @my-scope/pi-statusline --access public
```

Rename `@my-scope` to your npm scope first (package names + README install lines).

## Install

```bash
pi install npm:@my-scope/pi-statusline     # one extension
pi install git:github.com/<you>/my-pi-agent   # everything (root pi manifest)
pi list / pi update --extensions / pi remove <source>
```

Rules:

- Runtime imports of extensions go in per-package `dependencies`.
- The Pi host packages (`@earendil-works/pi-*`, `typebox`) stay in `peerDependencies: "*"` and must never be bundled or listed in `dependencies` — a physical copy breaks Pi's module mapping.
- Extensions run with full user permissions. Review third-party source before `pi install`.

## Docs

- Extensions: <https://pi.dev/docs/latest/extensions>
- Packages: <https://pi.dev/docs/latest/packages>
