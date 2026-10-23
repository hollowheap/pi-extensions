# AGENTS.md

- Node >= 22.19, npm workspaces (`packages/*`). Run `npm install` at the root.
- Pi extensions live in `packages/pi-<name>/`: entry `src/index.ts`, thin `export default function (pi: ExtensionAPI)`, declared in that package's `pi.extensions` and added to the list in the root `package.json`. Exceptions: `@hollowheap/core` has no entry (it is a runtime library, not an extension); `pi-acp` is a standalone ACP server (`src/main.ts`) with a bundled pi extension in `src/extension/` and is not a `pi.extensions` package.
- Host modules (`@earendil-works/pi-*`, `typebox`) are `peerDependencies: "*"`. Never put them in `dependencies` and never bundle them.
- Runtime imports resolve only host modules, intra-package relative files, node builtins, and `@hollowheap/core` — the single documented exception (`artifacts/specs.md` D04). Core is a real `dependencies` entry at `^0.2.0` so pi installs it with the extension.
- Each extension loads in a fresh module instance (jiti, `moduleCache: false`); installed packages get separate module roots. Never share state via module-level maps across packages; shared state lives on the core registry `globalThis[Symbol.for("@hollowheap/core/state")]`. `pi.events` envelopes are synchronous, so mutate the envelope object before the emit returns.
- Do not reimplement rules, modes, or shell analysis in a consumer; vendored copies across packages are a bug. `@hollowheap/core` is the target owner (`artifacts/specs.md`, D01..D33).
- Commands: `npm test` (vitest, `packages/*/src/**/*.test.ts`), `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`biome check .`). Single test file: `npx vitest run packages/core/src/modes.test.ts`.
- Root `npm run build` (`tsc -b`) does not produce `packages/pi-acp/dist`. Rebuild that package with `npx tsc -p packages/pi-acp`; `dist/` is gitignored.
- Pi loads TS via jiti, so extensions need no build step. `noUnusedLocals`/`noUnusedParameters` are on; unused helpers fail typecheck.
- Scaffold with `npm run new -- pi-<name>`; never hand-copy manifests.
- Every behavior change ships with `src/*.test.ts` (mock `ExtensionAPI`, assert register + execute/handler). Run `npm test` + `npm run typecheck`; run `npm run lint` before finishing.
- Workflow artifacts live in `artifacts/` (`context.md`, `decisions.md`, `specs.md`, `plan.md`); `artifacts/logs/` and `artifacts/errors/` are gitignored.
- Commits are GPG-signed (`commit.gpgsign=true`); pinentry can time out. Retry or ask; never disable signing silently.
- Minimal diffs; don't refactor unrelated packages.
