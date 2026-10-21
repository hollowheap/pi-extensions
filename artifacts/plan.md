# Plan

## Standing decisions

- npm scope is `@hollowheap` for all packages including `@hollowheap/core`.
- `pi-statusline` reads `~/.pi/agent/statusline.json`, managed by home-manager.
- Formatter: 2-space indent (biome). `npm run new` scaffolds lint-clean packages.
- `pi-guard` rules use tags (`edit`, `read`, `search`, `shell`); unmatched calls ask the user, unknown tools included. No default allow rules.
- `pi-guard` shell gate (bash and powershell): allowlist rules (`allow shell <name> [prefix]`, chains split) with a three-way verdict (`allow` on match, `ask` with no rule, `deny` on hard denies: dangerous names, redirects, command substitution, deny rules). Per-call approvals live in the mode handlers.
- Modes are autonomy levels (settled 2026-10-19): `ask` passes rules verdicts through (unlisted reads ask too); `edit` runs reads/writes and keeps the shell allowlist (unlisted shell denied); `plan` follows read/search verdicts, denies non-plan writes, and denies unlisted shell; `autopilot` runs everything except hard shell denies. Writes to `artifacts/plan.md`, `artifacts/specs.md`, and anything under `artifacts/tasks/` always ask, in every mode; `artifacts/plans/` is not special.
- `/budget` sets the session token cap (autopilot gate); totals accumulate from `message_end` usage, over-cap aborts the next run.
- Statusline extension layer runs over `pi.events` (`statusline:values` / `statusline:request`); providers `mode-guard` and `budgets`, no cross-package imports.
- `pi-dashboard` `setHeader` sections (`header` art centered via `fitLines`, `terminal` command output left); refresh interval per section; default pi mascot attributed.
- Verdict truth lives in `packages/pi-guard/README.md` outcome matrix (mode x tag/verdict); `alt+m` cycles modes, leaving pi default `app.thinking.cycle` on `shift+tab` untouched.
- Default footer `z` shows `model`, `thinking`, `clock`.
- Split: `@hollowheap/core` is types-only plus the channel contract; `pi-guard` single-owns enforcement context (hook, approvals, shell gate, mode list + current mode, cwd override) and exposes `guard:modes` / `guard:mode-enter` / `guard:cwd-set` / `guard:cwd-query` envelopes; `pi-tools` vendors `rules.ts`/`loader.ts` copies (canonical: guard) and drives `/cd` + `fd`/`rg` through the cwd envelopes; `pi-budgets` owns its store and vetoes `autopilot` entry without a cap; `pi-autopilot` only appends its descriptor on `guard:modes`; `pi-question`, `pi-statusline`, and `pi-dashboard` round out the workspace, and only `pi-acp` is not a `pi.extensions` package. The `tool_call` hot path emits zero events. Provider names stay `mode-guard`/`budgets`; permission notices are prefixed `pi-guard:` (vendored copies keep the same prefix).
- Live pi startup is clean (verified 2026-10-14: zero extension errors; an earlier file-based smoke harness gave a false positive — shared jiti cache, unlike pi's per-extension instances).

## Open work

- Publish: `npm publish --workspace <pkg> --access public` per package (`core`, `pi-guard`, `pi-tools`, `pi-budgets`, `pi-autopilot`, `pi-statusline`, `pi-dashboard`, `pi-question`, `pi-acp`).
- pi-acp enforcement (direction, 2026-10-19): stop vendoring rules/bash/modes under `packages/pi-acp/src/extension/`; spawn pi with `pi-guard` loaded and consume its modes + the rpc `extension_ui_request{method:"confirm"}` approvals; the bundled extension keeps only `acp_*` tools with client/local fallbacks. Spec resolved in `artifacts/specs.md` ("pi-acp consumes pi-guard enforcement"); tasks A15-A24 below.

## Backlog (bottom)

- Custom budget limits on top of the shared budget/cap API, e.g. a daily limit counted in dollars instead of tokens (`usage.cost` is already reported per response).

## Resolved conflicts (2026-10-19)

Answers: pi-acp renames its write-silent mode to `edit` (matches pi-guard); pi-acp plan paths become `artifacts/plan.md` + `artifacts/specs.md`; the bash gate stops blocking first in both pi-guard and pi-acp. No-allow-rule now asks. Hard denies (dangerous names, redirects, command substitution, explicit deny rules) still block. pi-acp asks the ACP client; with no client it falls back to local rules (allow runs, no-allow-rule blocks).

Tasks appended to the ACP initiative below; checked as each verifies.

## Initiative: ACP adapter (active)

Objective: build an ACP adapter (`packages/pi-acp`) letting an ACP client drive pi over stdio JSON-RPC 2.0, backed by one `pi --mode rpc -ne -e <bundled extension>` process per ACP session (built-in tools stay enabled; the bundled hook governs them).

Recon (verified, not assumed): pi rpc is JSONL both ways; responses `{id,type:"response",command,success,data?,error?}`; events pass through verbatim (`text_delta{contentIndex,delta}`, `tool_execution_start{toolCallId,toolName,args}`, `tool_execution_update{...partialResult}`, `tool_execution_end{toolCallId,toolName,result,isError}`, `agent_settled{aborted}`); messages are `{role,content:[{type:text|toolCall...}],...}` with separate `toolResult` messages; `-e` extensions load in rpc mode, `session_start` fires (twice per session — socket lifecycle must be last-start-wins), env passes through, unix sockets work both directions; `get_commands` lists skills/commands but not tools; `getSystemPrompt()` is read-only. Protocol reference: the `@agentclientprotocol/sdk` (v1, PROTOCOL_VERSION 1) schema was read to pin the ACP surface, but the adapter takes no runtime dependency on it (Design). Verified spec fields: `ClientCapabilities{fs:{readTextFile,writeTextFile},terminal?}`, `SessionConfigOption category "mode"`, permission `allow_once/reject_once` kinds, `fs/read_text_file{path,line?,limit?}`, `terminal/output{output,truncated,exitStatus?}`, `NewSessionResponse{sessionId,configOptions?}` with optional legacy `modes` (omitted).

Design: adapter owns ACP framing with a small hand-rolled newline-delimited JSON-RPC dispatcher (no SDK dependency; spec method/type shapes vendored as local interfaces, verified against the SDK schema), one pi proc per session, a per-session unix socket (path via `HOLLOWHEAP_ACP_SOCKET`), and a JSON session store (`~/.local/share/hollowheap-pi-acp/sessions.json`, overridable with `HOLLOWHEAP_ACP_HOME`: sessionId, cwd, pi session file, title, updatedAt, agent mark). Spawn is `pi --mode rpc -ne -e <bundled extension>` plus `--append-system-prompt`: pi's built-in read/write/edit/bash stay enabled (no `-xt`), and the bundled extension's `tool_call` hook governs them with the same rules/mode/permission policy. The `acp_*` tools remain the preferred surface (client `fs`/`terminal` routing with local fallback), steered by the prompt appendix. Bundled extension (`src/extension/`, self-contained: vendored rules/loader/bash-gate from `pi-guard` and exec from `pi-tools`, tools `acp_read/acp_write/acp_edit/acp_bash/acp_fd/acp_rg/acp_eza`, modes plan/ask/edit in session memory) talks to the adapter over newline-JSON request ids; permission asks via `session/request_permission` with exactly allow_once/reject_once (deny never reaches the client); fs/terminal requests carry a 10s timeout; terminal completion via `terminal/output` polling on `exitStatus` (never `wait_for_exit`); `--append-system-prompt` teaches the model the acp_* tools and mode semantics. Client is Neovim Avante via `acp_providers` (command + args + env). No commits until requested. Tests deferred until requested.

Tasks:

- [x] Task A1: recon (rpc shapes, socket lifecycle, SDK/spec surface) + this plan. Check: plan exists with headings.
- [x] Task A2: scaffold `packages/pi-acp`, reshape to adapter layout (no external deps), `npm install`. Check: `npm run typecheck`.
- [x] Task A3: ACP server skeleton (initialize/new/list/load/cancel/set_config + JSON store + socket transport + pi spawn/request) with tests. Check: `npm test`.
- [x] Task A4: permission/fs/terminal client-request paths (10s timeout) with tests. Check: `npm test`.
- [x] Task A5: bundled extension (tools, modes, gates, socket client, markers/existence/compare checks) with tests. Check: `npm test`.
- [x] Task A6: prompt-turn bridge (event mapping, settle response, cancel→abort) with tests. Check: `npm test`.
- [x] Task A7: session/load replay via `get_messages` fixtures with tests. Check: `npm test`.
- [x] Task A8: spawn wiring + bin + README; live smoke (initialize/new/list, zero load errors, no model call). Check: smoke log.
- [x] Task A9: final `npm run typecheck`, `npm test`, `npm run lint`.

Verification: per-task checks above; no e2e model prompt possible here (no ACP client or live model in this environment) — prompt/tool paths covered by unit + fakes.

Resolution tasks:

- [x] A10: three-way `checkBash` in `pi-guard/src/bash.ts` + tests; `pi-guard` shell path asks on no-allow-rule; README matrix updated. Check: `npm test`.
- [x] A11: pi-acp vendored `bash.ts` three-way + hook/`acp_bash` ask client, local-rules fallback (`ToolDeps.connected`); tests. Check: `npm test`.
- [x] A12: rename pi-acp modes to `plan/ask/edit` and plan paths to `artifacts/plan.md` + `artifacts/specs.md` (extension, adapter, main appendix, README); tests. Check: `npm test` + `npm run typecheck`.
- [x] A13: guard `session/list` missing params; fix `plan.md:29` `-xt` drift. Check: `npm test`.
- [x] A14: `npm run typecheck`, `npm test`, `npm run lint`; rebuild `packages/pi-acp/dist`. Check: all green (2026-10-19: typecheck clean, 322 tests, lint clean, dist rebuilt via `npx tsc -p packages/pi-acp`).

## Initiative: pi-acp consumes pi-guard enforcement (active)

Objective: pi-guard is the only owner of rules, modes, and approvals inside the ACP pi process; the bundled extension shrinks to `acp_*` tools, the socket bridge, and guard-absent fallbacks. Contract and anchors: `artifacts/specs.md` ("pi-acp consumes pi-guard enforcement").

Order note: A15/A16 are pi-guard-side and land first; A17-A21 are pi-acp-side; A22 flips the spawn. Keep both green at every step.

Tasks:

- [ ] A15: pi-guard emits a `guard:tool-tags` query on `session_start` (prefilled with builtin `TOOL_TAGS`), caches the merged map, and `tool_call` reads the cache. Check: `npm test` (new pi-guard test: a contributor adds `acp_read -> read` and the hook applies read policy; unregistered `acp_*` still asks).
- [ ] A16: pi-guard gains a `guard:mode-set { mode, owner? }` command envelope: it stores the `ExtensionContext` from `session_start` as active and applies the mode through `switchMode` only when `owner === undefined || owner === active.sessionManager`. Check: `npm test` (veto path still blocks; unknown mode still notifies).
- [ ] A17: bundled extension contributes its `acp_* -> tag` map on `guard:tool-tags`, subscribes to `guard:modes`, and forwards the list to the adapter over a new socket method `modes`; no contributor answers → it forwards its local `plan`/`ask`/`edit` list. Check: `npm test` in `packages/pi-acp`.
- [ ] A18: bundled extension handles the adapter's socket `set-mode` request by emitting `guard:mode-set` (guard absent → applies locally). Check: `npm test`.
- [ ] A19: delete `packages/pi-acp/src/extension/{rules,loader,bash,modes}.ts` and their tests; delete the `tool_call` hook plus `getMode`/`BUILTIN_TAGS`/`BUILTIN_KINDS`/policy helpers in `extension/index.ts`; strip `checkBash`/`loadRules`/`decide`/`isPlanPath` from `extension/tools.ts`. Check: `npm test` + `rg -n "checkBash|loadRules|decide|isPlanPath" packages/pi-acp/src/extension` returns only the guard-absent bash fallback.
- [ ] A20: `PiRpc` gains a raw `respondUi(id, response)` write (today only `request()` can write, `pi-rpc.ts:104-113`); the adapter intercepts `extension_ui_request{method:"confirm"}` before ACP forwarding, maps it to `session/request_permission` (`allow_once`/`reject_once`), and replies `extension_ui_response{confirmed}`; no client/disconnected → `cancelled: true`. Check: `npm test` (allow, reject, disconnect cases).
- [ ] A21: adapter builds its mode config options from the extension's `modes` payload and forwards `set_config` to the extension; delete `MODES`/`modeOption` (`adapter.ts:28-29,145-172,545`). Check: `npm test`.
- [ ] A22: spawn wiring: `SpawnPiOptions.extensionPaths: string[]` with `pi-rpc.ts:163-176` emitting one `-e` per path; `main.ts` resolves the pi-guard dir via `createRequire(import.meta.url).resolve("@hollowheap/pi-guard/package.json")` with `HOLLOWHEAP_ACP_GUARD` override and skips it when unresolved; add the workspace dependency. Check: `npm test` + `npx tsc -p packages/pi-acp`.
- [ ] A23: docs: drop the "no dependencies" and pi-guard-vendoring claims in `packages/pi-acp/README.md:3,35`, update the mode/permission section, retire the pi-acp vendoring note in `packages/core/README.md:20`, and align the standing decisions here. Check: `npm run lint` + read-back.
- [ ] A24: full verification and live smoke: `npm run typecheck`, `npm test`, `npm run lint`, `npx tsc -p packages/pi-acp`; live ACP session shows a client mode switch reaching pi-guard and one `session/request_permission` for an unlisted call in `ask`. Check: commands green + smoke log.

Verification: per-task checks above; A24 closes the initiative and moves it to `artifacts/tasks/`.
