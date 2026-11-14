# Extension Review Summary

Date: 2026-10-29. Scope: all 16 extensions, deep-dive on `pi-web`,
`pi-subagents`, and `pi-todos` against published upstream packages.

Method: read local source, unpack npm tarballs for `pi-web-access@0.46.0`,
`pi-subagents@0.84.0`, `rpiv-todo@1.1.0`, then run disposable probes from
`artifacts/scripts/` with `npx jiti`.

## Highest-Risk Verified Bugs

| Area | Bug | Severity | Evidence |
| --- | --- | --- | --- |
| pi-web | DNS-resolved private hosts bypass the SSRF guard (`localtest.me`, `nip.io`). | Critical | `probe-web-ssrf.ts` |
| pi-subagents | A starting child is reconciled to `failed` before its socket exists. | High | `probe-subagents-lifecycle.ts` |
| pi-subagents | Abort marks `cancelled` but leaves a live child when the socket is unreachable. | High | `probe-subagents-lifecycle.ts` |
| pi-todos | Completed rows fill the widget limit and hide open rows. | High | `probe-todos-overflow.ts` |
| pi-web | Whole response body is buffered before truncation. | High | source read |
| pi-subagents | Completion and cancel race through non-atomic state writes. | Medium | source read |
| pi-todos | Todo blocks are ignored in headless/RPC sessions. | Medium | source read |
| pi-web | First provider returning `[]` stops search fallback. | Medium | `probe-web-fallbacks.ts` |
| pi-web | Non-OK response bodies are never canceled. | Medium | `probe-web-fallbacks.ts` |
| pi-todos | No `session_compact` handler; reload can lose state. | Medium | source read |

## Cross-Cutting Patterns

1. **Lifecycle states are too coarse.** `starting` and `running` share the same
   reconciliation predicate, so a transient missing socket is treated as death.
   The same predicate then marks a live process cancelled without killing it.
2. **UI gates state.** `pi-todos` only applies commands when `ctx.hasUI`; RPC
   sessions silently drop todos.
3. **Unbounded I/O.** `pi-web` buffers entire bodies and keeps an unbounded
   cache; neither has a byte cap.
4. **Dead safety machinery.** `pi-web` cache and rate limiter exist but default
   off and are not passed by the tools. R56 is nominally complete, not effective.
5. **Upstream is not bug-free.** `rpiv-todo` caches its branch forever and does
   not implement the priority feature its README advertises.

## Per-Area Direction

- **pi-web:** adopt `pi-web-access` or port its DNS/CIDR SSRF guard and bounded
  fetch. Local engine has no consumer beyond its own tools.
- **pi-subagents:** fix the lifecycle bugs before adding features. Adopt
  upstream only with an adapter for `subagents:state`.
- **pi-todos:** keep the text-block/panel shell. Port `blockedBy`, cycle
  detection, and drop-completed-first overflow; do not adopt `rpiv-todo` as-is.

Full trade-offs: `artifacts/brainstorm.md`. Upstream evidence:
`artifacts/research/pi-extension-landscape.md`.

## Artifact Drift

`artifacts/plan.md`, `specs.md`, and `decisions.md` mark R55/R56 and the
subagent/todo work complete. The probes above show the acceptance conditions are
not met. Do not treat the `[x]` state as proof of robustness until these are
fixed or explicitly waived.

## Overengineering Audit

All 59 original bullets across the 16 reviews were re-checked against
`artifacts/requirements.md` and `artifacts/decisions.md`: 18 remain
overengineered, 39 are requirement-backed, one is not actually overengineering,
and one is a split verdict. Each review now has an `## Overengineering Audit`
table with the per-item link and reason.
