# AGENTS.md

- Node >= 22.19, npm workspaces (`packages/*`). `npm install` at root.
- One extension per package under `packages/pi-<name>/`. Entry point is always `src/index.ts`, declared in that package's `pi.extensions`. Keep it a thin factory: `export default function (pi: ExtensionAPI)`.
- Never put `@earendil-works/pi-*` or `typebox` in `dependencies`; they are host-provided `peerDependencies: "*"`. Never bundle them.
- Pi loads TS directly (jiti) — no build step for extensions. `noEmit: true`.
- Scaffold with `npm run new -- pi-<name>`, never hand-copy manifests.
- Every behavior change ships with `src/*.test.ts` (mock `ExtensionAPI`, assert register + execute/handler). Run `npm test` + `npm run typecheck` before finishing.
- Minimal diffs; don't refactor unrelated packages.
