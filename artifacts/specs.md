# Specs and interface contracts

Living record of cross-package contracts. One section per spec; each section states the contract, the anchors, and its resolutions.

## Spec: pi-acp consumes pi-guard enforcement (resolved, 2026-10-19)

Status: resolved 2026-10-19 from pi and anchor sources; ready for implementation. Not implemented.

### Problem

`packages/pi-acp` re-implements policy that `pi-guard` already owns:

- `packages/pi-acp/src/extension/rules.ts`, `loader.ts`, `bash.ts` — byte-identical vendored copies of pi-guard's.
- `packages/pi-acp/src/extension/modes.ts:19-34` — a second `decide()` mirroring pi-guard's `applyPolicy` (`packages/pi-guard/src/modes.ts:33-46`).
- `packages/pi-acp/src/extension/index.ts:63,151-207` — its own mode state, `tool_call` gate, and shell gate.
- `packages/pi-acp/src/adapter.ts:28-29,145-172,545` — a hardcoded `MODES` list and `set_config` validation.

Drift is guaranteed: the two policy copies must be hand-synced, and already diverge structurally (`applyPolicy` is rule-driven; `decide` is a hand-written table).

### Goal

pi-acp owns only two things: (1) fallbacks when pi-guard is absent, and (2) making ACP work over `pi --mode rpc`. All rule, mode, and permission decisions come from pi-guard loaded in the same pi process.

### Non-goals

- Not changing pi-guard's policy semantics (see `packages/pi-guard/README.md` outcome matrix).
- Not removing the `acp_*` tools; they stay as the client-routing surface.

### Target architecture

Spawn the ACP pi process with pi-guard loaded alongside the bundled tools extension:

```text
pi --mode rpc -ne -e <pi-guard package dir> -e <pi-acp/src/extension> --append-system-prompt ...
```

Guard path resolution (resolved): pi's loader resolves `-e` values as filesystem paths, never as bare package names (`loader.js:663-699` resolves each configured path with `resolvePath` and only unpacks directories; a bare name becomes `<cwd>/@hollowheap/pi-guard` and fails). It does read `pi.extensions` from a directory (`loader.js:593-621`), so passing the pi-guard package directory loads `src/index.ts`.

- Primary: `createRequire(import.meta.url).resolve("@hollowheap/pi-guard/package.json")`, then `dirname(...)` → package dir. Works because pi-guard's manifest has no `exports` map, and requires adding `@hollowheap/pi-guard` to `packages/pi-acp/package.json` (its "no dependencies" claim at `README.md:3` must then change).
- Override: `HOLLOWHEAP_ACP_GUARD` (path to the package dir or extension entry).
- Fallback: unresolved guard → spawn without it; the bundled extension owns modes/permissions alone (Fallbacks section).

- pi-guard is the single enforcement owner (`tool_call` hook, modes, approvals, shell gate).
- `packages/pi-acp/src/extension/` keeps only `acp_*` tools (client `fs`/`terminal` routing with local fallbacks), the socket client, and the mode/permission bridge. It deletes `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts` and the `tool_call` hook.

### Interface contract: rpc approvals

pi's rpc mode already bridges extension UI to ACP-shaped requests. Verified shapes (`node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts:406-476`):

- Request: `{ type: "extension_ui_request", id, method: "confirm", title, message, timeout? }`.
- Reply: `{ type: "extension_ui_response", id, confirmed: boolean }` or `{ ..., cancelled: true }`.
- pi-guard's `requestApproval` (`packages/pi-guard/src/index.ts:66-88`) calls `ctx.ui.confirm`, which rpc-mode surfaces as the request above (`.../rpc-mode.js:85`).

Contract: the adapter answers every `method: "confirm"` request by calling ACP `session/request_permission` with exactly `allow_once`/`reject_once`, then replies `confirmed: true` for allow and `confirmed: false` for reject. With no client connected, reply `cancelled: true` (fail closed). No other `extension_ui_request` method is answered by policy; `notify`/`setStatus` etc. map to ACP where a client capability exists and are dropped otherwise.

### Interface contract: mode list

The adapter needs the mode list for `SessionConfigOption category "mode"` (`adapter.ts:145-172`). Contract:

- pi-guard's existing `guard:modes` query (emitted every `session_start`, `packages/pi-guard/src/index.ts`) is the source of truth.
- The bundled extension subscribes to `guard:modes`, forwards `{ modes }` to the adapter over the socket, and the adapter builds config options from names + descriptions.
- Fallback: if no `guard:modes` contributor answers within the session-start window, the extension forwards the built-in `plan`/`ask`/`edit` list itself. This is the "define fallbacks" obligation.

### Interface contract: mode set

rpc has no generic slash-command invocation (`rpc-types.d.ts:14-140`), so ACP `set_config` cannot drive pi-guard's `/mode`. Contract:

- pi-guard gains a `guard:mode-set { mode, owner? }` command envelope applied through its existing `switchMode` path (`packages/pi-guard/src/index.ts:124-147`), so the `guard:mode-enter` veto/notice still runs.
- The bundled extension, on adapter `set_config`, emits `guard:mode-set`; without pi-guard it falls back to its local default list.
- Scoping (resolved): `switchMode` needs an `ExtensionContext` for `ctx.ui.notify` and `ctx.sessionManager`. pi-guard already sees one on every `session_start` (`index.ts:230-235`); it stores it as the active context and the envelope handler applies only when `owner === undefined || owner === activeCtx.sessionManager`, ignoring stale owners. The notice surfaces to ACP as `extension_ui_request{method:"notify"}` (`rpc-types.d.ts:436`) which the adapter may drop.

### Interface contract: acp_* tool tagging

pi-guard's `TOOL_TAGS` (`packages/pi-guard/src/index.ts:37`) covers built-ins only, so `acp_read/acp_write/acp_edit/acp_bash/acp_fd/acp_rg/acp_eza` currently fall to the unknown-tool ask. Contract (resolved):

1. `guard:tool-tags` query (chosen): extensions register `{ name -> tag }` contributions; pi-guard composes its map at session start (`index.ts:163-164` consumes it synchronously per call) exactly like the existing `guard:modes` query (`index.ts:109-113`). Keeps policy single-owned and extensible; the bundled extension contributes `acp_read -> read`, `acp_fd/acp_rg/acp_eza -> search`, `acp_write/acp_edit -> edit`, `acp_bash -> shell`. Rejected: 2 (drop `acp_*` tools, losing client `fs`/`terminal` routing) and 3 (wrap built-ins, which cannot survive the hook running before execute).

### Interface contracts: data shapes

All envelope contributions are synchronous in-place mutations, matching `guard:modes` (`packages/pi-guard/src/index.ts:109-113`); the emitter owns the object and reads it back immediately.

```ts
// pi.events, pi-guard emits at session_start, contributors mutate
"guard:tool-tags": { tags: Record<string, Tag> }        // prefilled with builtins
"guard:modes":     { modes: ModeDefinition[] }          // existing, unchanged
"guard:mode-set":  { mode: string; owner?: unknown }    // command, pi-guard applies

// unix socket, adapter <-> bundled extension
"modes":    extension -> adapter  { modes: { name: string; description?: string }[] }
"set-mode": adapter -> extension  { mode: string }

// pi rpc, pi <-> adapter (rpc-types.d.ts:406-419, 463-476)
{ type: "extension_ui_request",  id: string, method: "confirm", title, message, timeout? }
{ type: "extension_ui_response", id: string, confirmed: boolean } | { id: string, cancelled: true }
```

Tag values are the four literals (`edit`, `read`, `search`, `shell`); the bundled extension keeps its own local union instead of adding a `@hollowheap/core` dependency, since the loader cannot resolve bare imports at runtime anyway.

### Fallbacks when pi-guard is absent

Only when pi-guard is not installed or fails to resolve (`SpawnPiOptions` degrades to the bundled extension alone):

- Modes: the bundled extension advertises the local `plan`/`ask`/`edit` list and applies `set_config` locally.
- Enforcement: none — no rules file, no allowlist, no mode policy. Reads and writes run.
- Shell: `acp_bash` asks the client for every command (`session/request_permission`); no client means deny. This is the rules-free degenerate case of "no allow rule → ask", not a second policy engine.
- Blast radius is bounded by the guard-absent condition and documented in the README.

### Removal list (on implementation)

- Delete `packages/pi-acp/src/extension/{rules,loader,bash,modes}.ts` and their tests.
- Delete the `tool_call` hook, `getMode`, and gate branches in `packages/pi-acp/src/extension/index.ts`.
- Delete the bash gate and mode import in `packages/pi-acp/src/extension/tools.ts`.
- Replace `MODES`/`modeOption` in `adapter.ts` with mode descriptors received over the socket.
- Widen `SpawnPiOptions.extensionPath` (`adapter.ts:40,68`, `pi-rpc.ts:158-171`, `main.ts:66-76`) to carry the guard dir plus the bundled entry as two `-e` flags.
- Add the `@hollowheap/pi-guard` dependency and drop the "no dependencies" claim (`packages/pi-acp/README.md:3`).
- Retire the pi-guard-vendoring note for pi-acp in `packages/core/README.md:20` and `packages/pi-acp/README.md:35`.

### Resolutions (2026-10-19)

1. Guard path: resolved above — directory path via `createRequire`, `HOLLOWHEAP_ACP_GUARD` override, spawn-without-guard fallback. Bare package names do not work through `-e`.
2. `acp_*` tagging: `guard:tool-tags` query, resolved above.
3. `guard:mode-set` scoping: `{ mode, owner? }` with pi-guard's stored active `ExtensionContext`, resolved above.
4. `ctx.hasUI` under rpc: true. `ExtensionContext.hasUI` is documented "true in TUI and RPC modes" (`core/extensions/types.d.ts:218-219`), and rpc-mode wires `ui.confirm` into an `extension_ui_request` (`modes/rpc/rpc-mode.js:85`). So `requestApproval` (`pi-guard/src/index.ts:66-88`) cannot short-circuit on `!hasUI`, and every ask becomes a confirm request. The adapter must therefore answer every confirm, including after client disconnect (reply `cancelled: true`).
5. Session-start firing: pi-guard emits `guard:modes` on every `session_start` (`index.ts:233` via `refreshModes`), and `session_start` fires for reasons `startup | reload | new | resume | fork` (`types.d.ts:561-568`). No specific firing is "the" one: the bridge forwards each `guard:modes` and the adapter adopts the latest (last-wins); contributors stay idempotent (pi-autopilot already is).

### Acceptance criteria

- `npm run typecheck`, `npm test`, `npm run lint` green; `npx tsc -p packages/pi-acp` builds dist.
- No policy duplication: `rg -n "decide|checkBash|applyPolicy" packages/pi-acp/src/extension` returns only fallback references, not a second implementation.
- Live ACP smoke: mode switch from the client reaches pi-guard; an unlisted call in `ask` raises one `session/request_permission`.
