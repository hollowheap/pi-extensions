# AGENTS.md

- Node >= 22.19, npm workspaces (`packages/*`). `npm install` at root.
- Extensions live under `packages/pi-<name>/`, entry `src/index.ts` declared in `pi.extensions`, a thin factory `export default function (pi: ExtensionAPI)`. Exceptions: `@hollowheap/core` is types-only (no entry); `pi-acp` is a standalone ACP server (`src/main.ts`) whose bundled pi extension lives in `src/extension/` and is not a `pi.extensions` package.
- Never put `@earendil-works/pi-*` or `typebox` in `dependencies`; they are host-provided `peerDependencies: "*"`. Never bundle them.
- Pi's loader resolves only host modules, intra-package relative files, and node builtins — no other bare imports at runtime (`import type` is erased and safe). Each extension gets a fresh module instance: never share state via module-level maps across packages; single-own state per extension and coordinate through synchronous mutable envelopes on `pi.events`.
- Pi loads TS directly (jiti) — no build step for extensions. `noEmit: true`.
- Scaffold with `npm run new -- pi-<name>`, never hand-copy manifests.
- Every behavior change ships with `src/*.test.ts` (mock `ExtensionAPI`, assert register + execute/handler). Run `npm test` + `npm run typecheck` before finishing.
- Minimal diffs; don't refactor unrelated packages.
