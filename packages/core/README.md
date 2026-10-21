# @hollowheap/core

Types-only contract package for the Hollowheap Pi extensions. This is a library, not an extension: it registers nothing with pi and has no `pi.extensions` entry.

## Why types-only

Pi's extension loader resolves only host modules, intra-package relative files, and node builtins — any other bare import fails at startup. Each extension is also evaluated with a fresh module instance, so module-level state is never shared across extensions. `import type` statements are erased before resolution and are safe; value imports from this package will break pi at startup (vitest still resolves them, so tests can use values, but extension runtime code must not).

## What lives here

- `types.ts` — `Tag`, `Effect`, `Verdict`, `Rule`, `ModeDefinition`, and the envelope shapes below. Imported with `import type` only.
- Channel contract (string literals at use sites; kept in sync by the integration test in `pi-guard`):
  - `guard:modes` — `ModesQuery { modes }`. Emitted by `pi-guard` every session start, pre-filled with its builtin descriptors (`plan`, `ask`, `edit`). `pi-autopilot` appends `autopilot`. Builtins-first order is deterministic regardless of extension load order.
  - `guard:mode-enter` — `ModeEnterQuery { mode, owner, veto?, notice? }`. Emitted by `pi-guard` before switching modes. `pi-budgets` sets `veto` when entering `autopilot` without a token cap; `pi-autopilot`'s descriptor `onEnter` attaches the warning notice. A veto discards the notice.
  - `guard:cwd-set` — `CwdSetCommand { owner, dir? }`. Emitted by `pi-tools` (`/cd`); applied blindly by `pi-guard`, which owns the override store. `/cd` validates directories (exists, inside root, rules-allow) before emitting; the hook re-enforces every call.
  - `guard:cwd-query` — `CwdQuery { owner, dir? }`. Emitted by `pi-tools` per `fd`/`rg` execution; filled by `pi-guard`, falling back to the session directory when unset.

## Vendored copies

`pi-tools` vendors byte-identical copies of `pi-guard`'s `rules.ts`/`loader.ts` (plus their tests), and `pi-acp`'s bundled extension vendors byte-identical copies of `pi-guard`'s `rules.ts`/`loader.ts`/`bash.ts` plus `pi-tools`' `exec.ts`. Sideways relative imports do not resolve through pi's extension symlinks. The `pi-guard`/`pi-tools` copies are canonical — edit those, then copy the files over unchanged. Divergence only affects search-result filtering cosmetics; the `tool_call` hook always re-enforces with the canonical copy.

## State ownership

Each stateful store has exactly one owning extension (module-level maps are safe: one instance per extension): modes + cwd override in `pi-guard`, budget totals + cap in `pi-budgets`. Cross-extension influence flows only through the envelopes above. The `tool_call` hot path emits zero events.
