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
- Core runtime foundation (2026-10-21): `@hollowheap/core` owns the permission engine, mode layers, session state, and shared primitives; consumers delegate and delete vendored copies. Spec in `artifacts/specs.md` ("core runtime foundation"); tasks T01-T18 below supersede A15-A24.

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

## Initiative: pi-acp consumes pi-guard enforcement (superseded 2026-10-21)

Superseded by the core runtime foundation initiative below. The A15-A24 roadmap (guard-side `guard:tool-tags`/`guard:mode-set` envelopes, spawn-without-guard fallback) is not implemented; its history is in commit `c861c6d`.

## Initiative: core runtime foundation (active)

Objective: make `@hollowheap/core` the runtime owner of permissions, modes, session state (mode + cwd), and shared primitives, so consumers delegate instead of duplicating. Contract: `artifacts/specs.md` ("core runtime foundation"). Supersedes the A15-A24 plan.

Order note: T01-T05 and T19 build core; T06-T10 migrate consumers (green after each); T11-T14 fix pi-acp; T15-T16 fix the UI consumers; T17 docs; T18 closes.

Tasks:

- [x] T01: core `policy.ts`: widen effects to allow/ask/deny, move glob/specificity/realpath/workspace-boundary matching from `packages/pi-guard/src/rules.ts:14-99`, omit array order; bump every workspace package to `0.2.0`. Check: `npm test` (core table tests: specificity, ties stricter, outside-root deny).
- [x] T02: core `config.ts`: mtime-cached permission loader for `<agentDir>/permissions.json` plus a `.pi/permissions.json` overlay only when `trusted`, with once-per-change diagnostics (port `packages/pi-guard/src/loader.ts:79-121`) and widened rule parsing. Check: `npm test` (cache hit, mtime change, malformed file, untrusted overlay skipped).
- [x] T03: core `shell.ts`: token-boundary prefix matching, split on `\n` and `&` as well as `&&`/`||`/`;`/`|`, strictest-part result, extend hard denies to interpreters and process substitution (port `packages/pi-guard/src/bash.ts:27-87`). Check: `npm test` (cases for `git` vs `github`, newline/background chains, `<(`, `bash -c`).
- [x] T04: core `exec.ts`/`format.ts`: bounded `runBinary` (maxBuffer, abort, okExitCodes, ENOENT/cwd errors), `truncateText`, `displayTarget`, `displayPath`; fold the three current implementations. Check: `npm test`.
- [x] T05: core `state.ts`/`modes.ts`: globalThis-backed `Symbol.for("@hollowheap/core/state")` registry (survives duplicate module instances), session store for mode/cwd, layer registry (first-wins, diagnostics), entry gates, and `evaluate()` implementing the five-step ladder; mode persistence via `appendCustomEntry("hollowheap.core.mode", { mode })` and `getEntries()` restore, re-running gates on restore (veto → `ask`). Check: `npm test` (two module instances share state; ladder cases for plan/edit/ask/autopilot; resume/fork restore; removed mode → ask).
- [x] T19: core `config.ts` + wiring: `loadModesConfig(agentDir)` for `<agentDir>/modes.json` (schema, restrictive-override validation, name collisions, once-per-change diagnostics) and `replaceConfigModes` at session start in pi-guard and the pi-acp extension. Check: `npm test` (valid layer, `allow` override rejected, collision diagnosed, reload replaces config layers).
- [x] T06: pi-guard: use core `evaluate`/`loadPermissions`/`truncateText`; delete `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts` and their tests; keep prompting, `/mode`, `alt+m`, statusline value. Check: `npm test` + `npm run typecheck`.
- [x] T07: pi-budgets: register the autopilot entry gate on core; drop the `guard:mode-enter` listener/envelope. Check: `npm test` (veto without cap, allow with cap).
- [x] T08: pi-autopilot: register the `autopilot` layer with allow defaults; drop the `guard:modes` listener. Check: `npm test`.
- [x] T09: pi-tools: `/cd` and `effectiveCwd` via core (works standalone); `fd`/`rg` keep `ask` paths (filter only `deny`) and pass `--glob … --` / `--regexp … --`; delete `rules.ts`, `loader.ts`. Check: `npm test` (standalone /cd, dash-leading pattern, ask-path result retained).
- [x] T10: pi-statusline + pi-dashboard cwd segments read core `effectiveCwd`. Check: `npm test`.
- [x] T11: pi-acp extension: replace vendored policy/`decide()` with core `evaluate`; delete `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts`, `exec.ts` and the local policy tests; hook asks over the socket on `ask`, denies when disconnected. Check: `npm test` + `rg -n "checkBash|loadRules|decide|isPlanPath" packages/pi-acp/src` empty.
- [x] T12: pi-acp spawn: add `-nbt` so built-ins cannot bypass ACP tools; assert args. Check: `npm test`.
- [x] T13: pi-acp lifecycle: close existing live session before reload and on startup-validation failure; register prompt completion before `prompt` (`adapter.ts:795-801`); reject pending prompts/permissions/clients on exit and close; push mode on connect/reconnect and buffer pre-handshake sets. Check: `npm test` (reload leak, prompt race, early set_config).
- [x] T14: pi-acp protocol/tools: forward the real tool-call id to `session/request_permission` (`adapter.ts:576-581`); bound terminal polling with a wall-clock timeout (`extension/tools.ts:217-241`); delete timed-out client entries (`client-requests.ts:40-56`); `acp_write` parent mkdir, `acp_edit` missing-file error, `acp_fd`/`acp_rg` separators, `acp_eza` `isDirectory()`; remove unused helpers. Check: `npm test` + `npm run typecheck`.
- [x] T15: pi-statusline: render extension segments through `styleComponent` (not `styleText`) and truncate left text first so right-pinned sections stay visible (`render.ts:40-61`). Check: `npm test` (pill styling, narrow width keeps right).
- [x] T16: pi-dashboard: AbortController per section, abort in-flight commands on `stop()` and `session_shutdown`; confirm dynamic width reaches `fitLines` (`index.ts:64-98,146-158`). Check: `npm test` (abort called, no post-shutdown render).
- [x] T17: docs/policy: `AGENTS.md:4` (core runtime dependency exception, drop "types-only"), core/pi-* READMEs (delete vendoring claims, document `dependencies`, `0.2.0`, and the `<agentDir>/permissions.json` + trusted overlay locations), pi-acp README spawn/mode/permission text, and `modes.json` schema plus mode-persistence behavior in core/guard READMEs. Check: `npm run lint` + read-back.
- [x] T18: full verification: `npm run typecheck`, `npm test`, `npm run lint`, `npx tsc -p packages/pi-acp`; live ACP smoke (client mode switch, one permission prompt with the real tool id, no built-in tool execution, mode restored after resume). Check: commands green + smoke log.

Verification: per-task checks; T18 closes the initiative and moves it to `artifacts/tasks/`.

## Initiative: ACP mode list and notices (closed 2026-10-22)

Objective: let the ACP client select every registered mode, not just the adapter's hardcoded `plan`/`ask`/`edit`, and give mode notices a channel to the client. Contract: `artifacts/specs.md` ("Mode list", "Mode notices"; S28, D34).

- [x] T20: the extension answers `get-modes` over the socket with the core registry's layers (`name`, optional `description`); the adapter fetches them at session start, validates `set_config` against them, and builds the mode config option from them, falling back to its built-in list. A mode notice rides in the returned option's description. Check: `npm test` (adapter offers the extension's modes, accepts `autopilot`, notice lands in the option description; extension answers `get-modes`).

## Initiative: pi-hooks, model-configurable tool hooks (active)

Objective: a `pi-hooks` extension that turns a JSON config into pi's `tool_call` and `tool_result` events, so the model can install its own pre-tool and post-tool commands through a bundled skill. Contract: `artifacts/specs.md` ("Spec: pi-hooks"); S29-S35, D35-D41.

The live task list is in `artifacts/plan.md` under "Open work" (T21-T26). This section records the initiative's place in the history.
