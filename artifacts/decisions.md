# Decisions

Settled decisions. Canonical line: `Dxx [Rxx]: decision`, followed by alternatives, consequences, and a final why line.

## Runtime foundation

- [x] D01 [R08]: `@hollowheap/core` becomes the runtime owner of rule parsing, permission-rule loading/caching (`<agentDir>/permissions.json` plus a trusted project overlay), path matching, and shell command analysis
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - one implementation for TUI and ACP; vendored copies drift.
- [x] D02 [R08]: Core also owns the mode registry, active session mode, and virtual cwd via session-scoped stores
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - replaces cross-package event query mutations that depend on load order.
- [x] D03 [R08]: Shared state lives on `globalThis[Symbol.for("@hollowheap/core/state")]`, not module scope
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the loader uses `moduleCache: false` and separate module roots per installed package, so module-level state is duplicated.
- [x] D04 [R08]: Core is a real `dependencies` entry for consumers (installed by pi with the package), remains free of `@earendil-works/*`/`typebox` imports, and is the single documented exception to the no-bare-imports rule
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - runtime import must resolve after `pi install`; host modules stay the only other exception.
- [x] D05 [R08]: Shared primitives: bounded subprocess runner (abort, exit-code allowlist, ENOENT/cwd diagnostics), mtime-cached JSON config with once-per-change diagnostics, output truncation, path/target formatting
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - removes three exec copies and four policy copies.

## Modes and precedence

- [x] D06 [R09]: Rule effects widen to `allow | ask | deny`
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - prompting on specific paths/tags must be declarative rather than procedural.
- [x] D07 [R09]: Modes are declarative layers (`defaults` per tag + restrictive `overrides`), replacing `apply()` callbacks and `inPlanPaths`
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - policy posture becomes data, testable without consumer code.
- [x] D08 [R09]: Fixed precedence: hard safety → project deny → mode overrides → project allow/ask by specificity (ties stricter) → mode defaults; array order never decides
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - deterministic, order-independent outcomes.
- [x] D09 [R09]: Mode matrix: `ask` (allow/ask/ask), `edit` (allow/allow/ask), `plan` (allow/deny/ask with plan-artifact edit overrides), `autopilot` (allow/allow/allow); `ask` is the session default
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - matches the correction table and existing user expectations.
- [x] D10 [R09]: Modes register in core, first-wins by name, entry gates run in registration order and the first veto blocks
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - deterministic registry without event-channel coupling.
- [x] D11 [R09]: Plan paths stay `artifacts/plan.md` and `artifacts/specs.md`; writes there ask in plan mode
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - accepting a plan is the approval dialog itself.

## Consumers

- [x] D12 [R10]: `pi-guard` keeps TUI prompting, truncation, `/mode`, `alt+m`, statusline value; all policy code moves to core
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - single owner, consumer stays thin.
- [x] D13 [R10]: `pi-budgets` owns the autopilot entry gate (no cap → veto) and cap abort; `pi-autopilot` only registers the layer
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - keeps budget policy in the budget package.
- [x] D14 [R10]: `pi-tools` writes `/cd` and reads effective cwd through core so it works without `pi-guard`; search results keep `ask` paths and drop only `deny`
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - current filtering returns empty results on ask-configured paths.
- [x] D15 [R10]: `pi-guard`/`pi-tools`/`pi-acp` never prompt for unknown tools on the ACP path without a client
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - no client means no approver; deny is the safe outcome.

## pi-acp

- [x] D16 [R11]: The bundled extension consumes core and deletes its vendored policy files
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - TUI and ACP must agree on modes and permissions.
- [x] D17 [R11]: Spawn adds `-nbt` so built-in read/write/edit/bash cannot run behind the client's back
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - ACP fs/terminal capabilities must be the only execution path.
- [x] D18 [R11]: ACP lifecycle: close the previous live session before reload and on startup failure; register prompt handlers before dispatch; reject pending prompts/permissions/clients on exit/close; push mode on connect and buffer pre-handshake sets
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - leaks and dropped turns today.
- [x] D19 [R11]: Permission requests carry the real pi tool-call id; terminal polling is wall-clock bounded; timed-out client RPCs delete pending entries
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - client correlation and leak-free timeouts.
- [x] D20 [R11]: `acp_write` creates parent dirs, `acp_edit` refuses buffer/disk drift and missing files, `acp_fd`/`acp_rg` terminate flags with `--`, `acp_eza` verifies a directory
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - match `SYSTEM_APPENDIX` promises and block flag injection.

## UI consumers

- [x] D21 [R12]: Statusline renders extension segments through the component/pill pipeline and truncates left-first so right-pinned sections stay visible
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - extension segments currently look different and the right side is cut.
- [x] D22 [R12]: Dashboard aborts in-flight periodic commands on stop/shutdown and keeps width dynamic
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - no work after shutdown; narrow terminals must fit.

## Custom modes and persistence

- [x] D23 [R13]: `@hollowheap/core` moves to 0.2.0; consumers depend on `^0.2.0`
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the runtime foundation is a breaking API change (Effect widens, `ModeDefinition.apply` removed).
- [x] D24 [R13]: The active mode persists across `session resume`/`fork` as a session custom entry (`appendCustomEntry("hollowheap.core.mode", { mode })`, restored from `getEntries()`)
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - user choice; the session file is the durable boundary and fork copies entries.
- [x] D25 [R13]: Config-defined mode layers live in `<agentDir>/modes.json` (default `~/.pi/agent/modes.json`), following the `statusline.json`/`dashboard.json` convention
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - package configs already live in the agent config folder, not the project.
- [x] D26 [R13]: `modes.json` supports `{"modes": {"<name>": {"defaults": {...}, "overrides": [...]}}}`; overrides must be `ask`/`deny`; config layers cannot shadow built-in or package modes; invalid entries are dropped with once-per-change diagnostics; config layers are replaced on reload while built-ins/package layers persist
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - one predictable schema; config cannot redefine `ask` into an allow-all.
- [x] D27 [R13]: Entry gates also run when a mode is restored from the session; a veto falls back to `ask` with a notice
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a persisted `autopilot` must not resume without its budget cap.

## Permissions scope and release

- [x] D28 [R14]: Permission rules move to `<agentDir>/permissions.json` (default `~/.pi/agent/permissions.json`), following the `modes.json`/`statusline.json` config-dir convention
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - config belongs in the agent config folder, not each project.
- [x] D29 [R14]: A project `.pi/permissions.json` is an overlay loaded only when `ctx.isProjectTrusted()` is true; untrusted projects are ignored with a once-per-change notice, while agent-dir rules still apply
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a cloned repo must not grant itself permissions.
- [x] D30 [R14]: `pi-budgets` computes usage as a `getBranch()` baseline at session start plus `message_end` deltas
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - current maps reset on resume/fork and undercount against the cap.
- [x] D31 [R14] [R22]: All nine workspace packages move to `0.2.0` together, and consumer dependencies use `^0.2.0`
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - one coordinated release; consumer behavior changes with the core refactor.
- [x] D32 [R14]: `session/request_permission` has no wall-clock timeout; it is rejected only by client reply, disconnect, child exit, or session close
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - user choice; no silent denial while the client is still deciding.
- [x] D33 [R14]: Plan-path detection resolves against the effective cwd (`/cd` override), not the original workspace root
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - `/cd` exists to recover from starting the session in the wrong directory, so policy should follow it.
- [x] D34 [R14]: The ACP adapter learns the mode list from the extension over the socket and offers every registered mode to the client; a mode notice rides in the returned config option's description
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the extension owns the registry, so a hardcoded `plan`/`ask`/`edit` list hid extension modes such as `autopilot` and left mode notices with nowhere to go.

## pi-hooks extension

- [x] D35 [R15]: A hook runs a shell command; pi-hooks passes the tool call JSON on stdin and reads the decision from stdout
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - one mechanism that works for any language, and it lets the model author hooks such as "after every Edit, run the tests" without writing an extension.
- [x] D36 [R15]: Hooks are configured in `<agentDir>/hooks.json`, plus `<project>/.pi/hooks.json` loaded only when the project is trusted
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - matches the permissions overlay (D29) and pi's own trust model, so a clone cannot install hooks of its own.
- [x] D37 [R15]: A pre-tool hook may only block the call with a reason or let it proceed; it never rewrites the tool arguments
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a hook that silently redirects a call hides the change from both the model and the user.
- [x] D38 [R15]: A post-tool hook appends its output to the tool result, so the model sees it
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - that is what makes "run the tests after each edit" useful, and appending cannot hide output the model needs.
- [x] D39 [R15]: The model configures hooks through a skill alone, writing the JSON with the file tools it already has; pi-hooks adds no model-callable tool
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the schema is teachable in prose, and a config tool would add a second way to install commands that run on every tool call.
- [x] D40 [R15]: A pre-hook that fails or times out blocks the call, with the failure as the reason
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a broken enforcement hook must not silently allow the call; the reason tells the user what to fix or disable.
- [x] D41 [R15]: The default skill ships inside the pi-hooks package and is contributed through pi's `resources_discover` event (opt-in via `PI_HOOKS_DISCOVER_SKILL=1` to avoid prompt noise)
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a package's `skills/` directory is only discovered for installed packages, so a local `pi -e ./extensions/pi-hooks` run would miss the skill; `resources_discover` is the only extension-level route and is the pattern pi's own example uses. Disabled by default to keep the session prompt minimal.

## Tool exposure and caching

- [x] D42 [R16]: `fd` and `rg` register with `exposure: "codemode"`, and installs keep `tool_search` disabled
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - scripts keep both callable without changing the declared tool set, and listing them in the codemode description avoids a discovery round while the prefix stays stable; `tool_search` also searches `codemode`-exposure tools, so enabling it would activate `fd`/`rg` mid-session and mutate the prefix.
- [x] D43 [R16]: `pi-tools` activates the registered `codemode` tool on every `session_start`, including reload, and its README documents that behavior
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - codemode exposure is otherwise unreachable; auto-activation plus documentation was chosen over a direct-schema fallback, and reload re-activation keeps a newly loaded `pi-tools` reachable.

## Tool-free questions

- [x] D44 [R17]: `pi-question` stops registering a model tool; the model emits tagged fenced blocks in assistant text, and the extension reads them on `message_end`
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the user wants questions to be part of the response format, not a tool call, so the model can ask without a tool schema or a tool-result round trip.
- [x] D45 [R17]: `@hollowheap/core` owns a host-free tagged-block scanner and minimal markdown AST (H2, ordered/unordered list, checkbox, paragraph); `pi-question` owns the `question` tag parser, dialogs, prompt section, and answer message
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the scanner is reusable by future `create_todos`/`complete_todos` handlers while core stays free of host imports (D04).
- [x] D46 [R17]: Fence syntax is `'''<tag>` at line start through a closing `'''`; a `question` body uses one H2 per question and an ordered list of options; every option prefixed `[ ]` (or `[x]`) means multi-select, no checkbox means single-select; the UI always appends the final write-in option, and the model must not write one
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the delimiter does not collide with backtick code fences, and checkbox presence is the least verbose mode marker.
- [x] D47 [R17]: TUI uses sequential dialogs: single-select through `ctx.ui.select` plus `ctx.ui.input` for write-in; multi-select through a custom checkbox dialog with inline write-in; RPC uses `ctx.ui.select` for single and a select-loop with toggle rows plus Done for multi; print/json get no question contract
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - `custom()` is unavailable in RPC, while `select`/`input` are supported there; sequential dialogs match the chosen per-question flow.
- [x] D48 [R17]: The question format reaches the model through a stable `before_agent_start` system-prompt section (`systemPromptOptions.sections.question_format`) only when `ctx.hasUI`
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a system-prompt section is the host's intended contract mechanism and stays out of print/json modes where the model could not get an answer.
- [x] D49 [R17]: The raw block is removed from TUI display only, via `registerMarkdownTransformer` for assistant messages; the stored assistant message and model context keep it. Collected answers return as a custom `hollowheap.question.answers` message with `display: true` and `deliverAs: "followUp"`, listing numbered answers only
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - display-only stripping avoids mutating the model transcript, and the retained fence lets the model map numbered answers without quoting the questions again.
- [x] D50 [R17]: Cancelling any dialog cancels the whole set, sends no follow-up, and leaves the fence in context; there is no tool fallback
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a partial answer set would be ambiguous, and the user chose silent cancellation.
- [x] D51 [R17]: The `question` tool and its TypeBox/pi-ai dependencies are removed; `pi-question` adds `@hollowheap/core` as a real dependency, and the breaking removal is documented. Package version bumps are deferred to the next coordinated release
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the feature is a breaking API change, but bumping only `pi-question` would break the workspace `^0.2.0` core dependency; a coordinated release handles the version move.
- [x] D52 [R17]: `pi-question` handles and display-strips only valid `question` blocks; unknown tags and fully closed malformed question blocks are left untouched and visible, while an open question fence may be hidden during streaming, with no crash
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - future tag handlers need the scanner without this extension stealing their blocks, and a malformed block should remain diagnosable rather than disappear.
- [x] D53 [R17]: A question has 0–8 options (0 means free-text only), the write-in answer is capped at 500 characters, and multiple H2 questions are asked one after another in source order
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the write-in makes 0 options useful, the cap matches the old tool, and sequential order keeps the dialog flow predictable.

## Tool-free todos

- [x] D54 [R18]: A new `extensions/pi-todos` extension owns `create_todos`/`complete_todos` parsing, session state, the `todos_format` prompt section, `/todos`, and the status count; it registers no model tool, and core exposes only the scanner/AST
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - mirrors pi-question's boundary, keeps todo state/UI cohesive, and keeps core host-free (D04).
- [x] D55 [R18]: Todo state is a session custom entry (`hollowheap.todos`) on the active branch, restored on session start; create appends and complete marks done, with no global or project-file state
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - resume and fork stay correct, and sessions do not leak into each other.
- [x] D56 [R18]: `create_todos` uses an ordered list of task texts and appends; the extension assigns stable numeric IDs; `complete_todos` uses an ordered list of numeric IDs; one follow-up confirmation surfaces the full list with IDs
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - append avoids destructive replacement, IDs are stable for completion, and the model learns IDs without a tool result.
- [x] D57 [R18]: `/todos` lists every todo with its ID and done marker; `ctx.ui.setStatus("todos", ...)` shows open/total
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the command is discoverable, and the count is glanceable without consuming transcript space.
- [x] D58 [R18]: Todo blocks and the `todos_format` prompt section are active only when `ctx.hasUI` is true; TUI and RPC process them, while print/json add no section and ignore blocks
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - matches the question gating and the UI-only `/todos`/status surface, so non-interactive runs get no hidden state.
- [x] D59 [R18]: The TUI transcript strips valid todo blocks only; the stored message and model context keep the raw fence, RPC clients still receive it, and unknown tags or fully closed malformed blocks stay visible
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - consistent with D49/D52 and keeps malformed output diagnosable.
- [x] D60 [R18]: A compact `todos` widget above the editor lists up to five open todos with their IDs, adds `+N more (/todos)` when capped, omits completed todos, and clears when none remain; `/todos` keeps the full list and the status count stays
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a widget participates in layout, so it reflows the transcript instead of covering it like an overlay.

## Code intelligence

- [x] D61 [R19]: A new `extensions/pi-code-intel` extension owns code intelligence and registers one `code_intel` tool with `exposure: "codemode"`; `pi-tools` stays stateless and core gains no host or process code
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - LSP servers need lifecycle, config, and cleanup, which do not belong in the stateless fd/rg package or the host-free core.
- [x] D62 [R19]: `code_intel` is a dependency-free LSP client over stdio using Node builtins; it lazily starts one server per server command/args plus workspace root, reuses it across queries, applies request timeouts, and kills every server on session shutdown
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - no other runtime dependency is permitted, and per-query spawning would dominate latency for position-based queries.
- [x] D63 [R19]: Server definitions come from built-in language mappings overlaid by `<agentDir>/code-intel.json`; servers spawn only when `ctx.isProjectTrusted()` is true, never auto-install, and return a setup hint when the command or config is missing
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - language servers execute project code, so project trust is the boundary; auto-install would widen the supply-chain surface.
- [x] D64 [R19]: `code_intel` is read-only and supports `definition`, `references`, `document_symbols`, and `workspace_symbols`; input positions are 1-based, results are capped and path-checked with core read/search rules, and unsupported files or missing servers return explanatory text instead of throwing
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - the model should query by editor-style coordinates, and returned locations must respect pi-guard policy.

## Background tasks and subagents

- [x] D65 [R20]: A new `extensions/pi-tasks` extension owns durable task lifecycle, the task registry, and the direct `task`/future `subagent` tools while keeping the host built-in `bash` tool untouched; `pi-tools` stays stateless and core gains no process or host code
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - persistence, trust, and cleanup need one lifecycle owner, while keeping built-in `bash` avoids reimplementing foreground shell execution.
- [x] D66 [R20]: `task` and the future `subagent` tool are direct tools; `code_intel` stays codemode
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - essential orchestration must always be visible and callable, while auxiliary navigation can stay out of the direct schema.
- [x] D67 [R20]: `pi-tasks` keeps the built-in `bash` tool untouched (no `/background` or `alt+b` mid-flight detach) and starts background shell commands explicitly through `task({ action: "start", command })`; `pi-guard` gates `task` (`action === "start"` as `tag: "shell"` against `command`, while read-only `list`/`status`/`wait` and `cancel` pass without a shell prompt) and `pi-hooks` sees `task` tool calls
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - deciding up front whether a command runs in the background avoids reimplementing Pi's foreground `bash` tool while preserving full `pi-guard` shell policy and user confirmation on `task.start`.
- [x] D68 [R20]: The `task` tool supports `start`, `list`, `status`, `wait`, and `cancel`; `wait` blocks until exit or timeout (including across pi restarts via the task state file); completion does not trigger a turn
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - explicit `start` on `task` keeps background orchestration on a single tool, the agent stays in control of when to wait, and background work must not inject unsolicited model turns.
- [x] D69 [R20]: Durable shell tasks survive pi exit via a detached Node runner shim that streams output to `<agentDir>/tasks/<id>.log` and writes exit state to `<agentDir>/tasks/<id>.json` (both `0600`), start only in trusted projects, and are cleaned up manually; `list`/`status`/`wait` reconcile dead shims using recorded PID plus process start time to prevent PID-reuse false positives, and `session_shutdown` leaves them running
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a detached shim records exit status even when pi is closed, start-time checks prevent OS PID reuse bugs, and project trust plus `0600` files bound the risk of outliving the session.
- [x] D70 [R20]: The task layer is generic in v1: a task record has `id`, `kind`, `status`, `cwd`, `startedAt`, `finishedAt`, `exitCode`, `output`, `wait`, and `cancel` (`shell` is the first kind); `inbox`/`outbox` are deferred until the subagent RPC spec defines the message envelope
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - subagents share the lifecycle and wait/cancel seam now, while deferring message queues avoids dead fields before the parent-hub protocol exists.
- [x] D71 [R20]: Subagents are session-scoped and use parent-hub routing between RPC child processes; only shell tasks are durable; no hub daemon
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a parent hub cannot route after the parent exits, and a durable daemon adds trust and lifecycle complexity before the subagent feature exists.
- [x] D72 [R20]: ACP mode keeps `acp_bash` and the client terminal; the `pi-tasks` local task tool is inactive there
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - ACP command execution must stay behind the client terminal capability, and local background processes would bypass it.

## Tool exposure and guard tags (2026-10-25)

- [x] D73 [R21]: `fd`, `rg`, and `code_intel` default to `direct`; each package reads `direct|codemode|hidden` from its agent config (`pi-tools.json`, `code-intel.json`), and codemode is activated only when a tool is configured as `codemode`
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - a single search or LSP lookup through a script is worse than a direct call, direct tools stay visible and still pass `pi-guard`, and codemode remains for batch/filter/MCP orchestration. Supersedes the codemode-default parts of D42, D43, D61, and D66.
- [x] D74 [R21]: `permissions.json` accepts a `tools` map of tool name to `edit|read|search|shell`; built-in mappings win, invalid tags are diagnosed, and unknown tools still ask
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - MCP tools need classification without letting config remap destructive built-ins.
- [x] D75 [R21]: The todo widget shows up to 10 open todos; `/todos` and the status count remain unchanged
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.
  - five hid too much of a normal list, while ten fits without taking over the transcript.

## Web tools

- [ ] D76 [R01]: A new `extensions/pi-web` extension owns provider adapters, normalization, key/config loading, URL safety, and both tools; `pi-tools` stays local and stateless.
  - Alternatives: extend `pi-tools`; split search and fetch packages.
  - Consequences: one more package in the suite and one more config surface.
  - Network providers and their failure modes need one lifecycle owner, while the local search package should not grow HTTP clients.

- [ ] D77 [R01] [R02]: `web_search` and `web_fetch` are direct tools, not codemode tools.
  - Alternatives: one `web` action tool; codemode-only.
  - Consequences: two more direct tool schemas; better discoverability and fewer round trips.
  - Each is usually one call; hiding them behind a script repeats the `fd`/`rg` mistake.

- [ ] D78 [R02] [R03]: Each provider has its own adapter, and all adapters normalize into one search shape and one fetch shape. V1 capabilities: Tavily search + extract, Exa search + contents, Firecrawl search only; Jina is excluded because its free tokens are non-commercial.
  - Alternatives: one generic JSON mapper; four separate tools; include Jina with a licensing caveat.
  - Consequences: three keyed adapters plus a raw fallback; adding a provider does not change the tool contract.
  - Provider payloads differ enough that a generic mapper would be fragile; capability flags keep fetch free of a browser dependency.

- [ ] D79 [R02] [R03]: Search results normalize to `title`, `url`, `snippet`, `provider`; fetch results normalize to `url`, `finalUrl`, `provider`, `contentType`, `content`, `links`, `media`, `truncated`. `links` entries are `{url, text?}` and cap at 50; `media` entries are `{url, kind, alt?, mimeType?}` with `kind` one of `image`, `video`, `audio`, `pdf`, `other` and cap at 20. Search defaults to 5 results and caps at 10; fetch defaults to 20k characters and caps at 100k; provider requests time out at 15s.
  - Alternatives: per-provider result shapes; uncapped output; larger defaults; no media metadata.
  - Consequences: adapters may discard provider-specific fields in v1; media is metadata only.
  - Bounded output keeps context use predictable, and the same shape lets fallback stay invisible to the model.

- [ ] D80 [R04]: Provider selection is automatic by key presence using a fixed cheapest-first order, with `web.json` able to override each order array; the first entry is the default. Default search order is Exa, Tavily, Firecrawl; default fetch order is Exa, Tavily, then raw HTTP. A provider failure falls through to the next entry.
  - Alternatives: explicit provider only; config order only; Tavily-first order.
  - Consequences: a failing primary can add latency before fallback; order must be documented; credit math changes should be handled by config.
  - Zero-config when one key is set, deterministic when several are set, cheapest free-tier usage first, and still overridable.

- [ ] D81 [R04]: Keys come only from environment variables: `TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`. `web.json` never stores keys; it only contains order arrays. Keys are never logged or included in errors.
  - Alternatives: keys in web.json; host settings namespace.
  - Consequences: standalone users must export keys; no key file to protect.
  - Env is supplied by the user's config layer and keeps secrets out of a JSON file.

- [ ] D82 [R03]: V1 does not expose headless-browser or JavaScript rendering. Firecrawl is search-only; fetch uses Tavily Extract, Exa Contents, then a dependency-free raw HTTP and HTML-to-text fallback.
  - Alternatives: Firecrawl scrape; Browserless; Playwright; Jina Reader.
  - Consequences: JS-only pages may return empty or incomplete content; the limitation must be documented.
  - Rendering adds a browser stack, heavier failures, and a larger security surface; static extraction covers docs and most reference pages.

- [ ] D83 [R05]: `web_fetch` accepts only `http`/`https`, rejects loopback, private, link-local, and metadata targets on every redirect hop, and caps redirects at 5. DNS-rebinding hardening is deferred.
  - Alternatives: no filtering; full DNS resolution and address pinning.
  - Consequences: hostnames resolving to private addresses may still pass; document the residual risk.
  - Basic SSRF protection is mandatory for a URL tool; full DNS pinning is more code than v1 needs.

- [ ] D84 [R06]: `pi-guard` maps `web_search` to `search` and `web_fetch` to `read` in its built-in tag map; the user `tools` map cannot override built-ins.
  - Alternatives: require every user to add tags; allow overrides.
  - Consequences: users who want a different tag need a guard code change, not config.
  - Web tools should work without extra config while still respecting path/search policy; built-in safety stays authoritative.

- [ ] D85 [R07]: The package README, root README, and suite entry document the three keyed providers, the raw fallback, free-tier caveats, env key names, `web.json` order arrays, normalized shapes, caps, fallback order, media metadata, and the no-rendering limitation.
  - Alternatives: provider docs only.
  - Consequences: README maintenance when free tiers change.
  - Provider terms and limits change; the user must be able to audit what leaves the machine.

- [ ] D86 [R02] [R03]: V1 adds no separate response cache. The session transcript already exposes earlier tool results to the model; a tool-level cache is deferred until repeated identical calls prove common.
  - Alternatives: 5-minute in-memory cache; on-disk cache.
  - Consequences: repeated identical provider calls still cost quota.
  - An extra cache adds invalidation and privacy surface without changing what the model can already see.

- [ ] D87 [R03]: `web_fetch` returns Markdown content plus extracted links and media metadata; it never returns binary payloads or image blocks.
  - Alternatives: image blocks; download to temp files.
  - Consequences: the model cannot inspect image pixels or PDF bytes through this tool.
  - Metadata keeps the tool useful for media-heavy pages without blowing context or adding download cleanup.

## Classifier

- [ ] D88 [R23]: `pi-classifier` exposes one direct `decide` tool with one question per call. `kind` is `choice`, `score`, or `bool`; `choice` takes 2–10 `{label, description}` options, `score` takes an ordered 2–10 scale, and `bool` takes `true`/`false` descriptions. The tool returns the label/score/probability, confidence, model, and usage; it returns no free-form rationale.
  - Alternatives: multiple questions per call; separate `decide` and `classify` tools; chat model with rationale.
  - Consequences: callers repeat calls for multiple questions; output stays structured and cheap.
  - The classifier primitives already provide choice, score, and bool; a rationale would require a different model path.

- [ ] D89 [R24]: Model selection is explicit in `<agentDir>/classifier.json`; there is no fallback to the first available classifier. Config fields are `model` (`provider/model-id`), `timeoutMs` (default 5000), `maxInputChars` (default 20000), and `cacheTtlMs` (default 600000, 0 disables).
  - Alternatives: first-available fallback; per-call model override; no config.
  - Consequences: missing or invalid config makes `decide` unavailable until fixed.
  - Explicit selection keeps cost, privacy, and behavior predictable.

- [ ] D90 [R25]: `decide` caps input at the configured limit, times out on the configured deadline, and returns explanatory error text for invalid input, missing config, unavailable auth, classifier error, abort, or timeout. It never mutates session state or throws for capability failures.
  - Alternatives: let provider errors throw; no input cap; no timeout.
  - Consequences: callers must handle an error-string result; very large text is rejected rather than truncated silently.
  - Classification is advisory and must not block the workflow.

- [ ] D91 [R26]: Successful decisions are cached in memory per session and concurrent identical calls share one in-flight request. The key includes model, kind, question, criteria, and input; TTL comes from config; aborted or failed calls are not cached.
  - Alternatives: no cache; disk cache; cache without in-flight dedupe.
  - Consequences: identical calls after TTL or on a new session hit the classifier again.
  - This removes duplicate latency and quota use without persisting private input.

- [ ] D92 [R27]: The package is a direct Pi tool only. It does not activate codemode, add a CLI, register a service, or depend on `pi-guard`. A direct tool is callable from codemode scripts as well.
  - Alternatives: CLI now; guard service now; core service registry.
  - Consequences: OpenCode and other harnesses cannot use it until a CLI exists; `pi-guard` keeps its own judge.
  - Start with the smallest useful surface and extract shared layers when a second consumer appears.

- [ ] D93 [R28]: The classifier payload contains only the caller-supplied `input`, `question`, and criteria. It never adds cwd, mode, session history, file contents, or tool output, and v1 adds no automatic redaction; callers must omit secrets.
  - Alternatives: automatic context enrichment; regex redaction; local-only enforcement.
  - Consequences: privacy depends on the caller and tool description; a remote classifier sees exactly what the model sends.
  - Classifier input may contain private text, so payload control must be explicit.

- [ ] D94 [R29]: Use one process-wide FIFO prompt queue exported by core and shared across extension module roots; every blocking dialog or confirmation site opts in, while nested acquisition is forbidden.
  - Alternatives: per-session queue; extension-local queue; rely on the host UI; monkey-patch `ctx.ui`.
  - Consequences: a hung dialog blocks later prompts; consumers must call the helper explicitly; a reentrant prompt must bypass the lock or fail.
  - Cross-extension collisions need one owner; process-wide is the smallest scope that covers main-session prompts without new dependencies.

- [ ] D95 [R30]: Run each subagent as a detached `pi --mode rpc` child supervised by a per-child runner built on `@hollowheap/process`; the runner owns stdio, exposes a Unix socket for live reattach/steer, and persists state, logs, and session files under `<agentDir>/subagents/`; no central daemon.
  - Alternatives: in-process SDK sessions; central parent-hub daemon; session-scoped children.
  - Consequences: children outlive the parent; live reattach needs socket and state reconciliation; one runner and socket per child; supersedes D71's session-scoped parent-hub design.
  - Live steering plus durable children need a process that owns the child after the parent exits; a per-child runner avoids a daemon.

- [x] D96 [R30]: Expose one direct `subagent` tool with `start`, `list`, `status`, `send`, `wait`, `cancel`, and `resume` actions; one child per `start`, no parallel-array parameter, and concurrency comes from multiple calls plus config.
  - Alternatives: a parallel tasks array; single-call-only tool; separate prompt/steer tools.
  - Consequences: the parent model tracks ids; the schema has lifecycle actions; `send` steers a running child and prompts an idle one.
  - One child per call keeps failure attribution and write-lock ownership clear.

- [x] D97 [R31]: Read `<agentDir>/subagents.json` for `maxConcurrent` (default 4, max 8), `maxDepth` (default 1, max 3), `defaultTimeoutMs` (default 30 minutes, max 24 hours, 0 disables), and `writeLockTimeoutMs` (default 30 seconds); invalid values diagnose and fall back.
  - Alternatives: hardcoded limits; per-call limits only; no timeout.
  - Consequences: config is shared by parent and children; depth is passed through the child environment; limits bound cost and process growth.
  - Defaults must be safe without configuration, while allowing tuned concurrency and recursion.

- [x] D98 [R31]: Serialize `write`, `edit`, and `bash` across child processes with a per-tool lock at `<agentDir>/subagents/write.lock`; atomic directory creation records owner PID and start time, the child extension releases on tool result, error, abort, or timeout, and stale owners are reclaimed.
  - Alternatives: one write-lease per child lifetime; cap all children to one; worktrees per child.
  - Consequences: read-only children proceed in parallel; writers wait; denied or crashed calls need release handling; lock wait is bounded.
  - Per-tool locking preserves concurrency without letting two children mutate the same tree.

- [x] D99 [R32]: Load agents from `<agentDir>/agents/*.md` and, only for trusted projects, `<project>/.pi/agents/*.md`; frontmatter supplies name, description, tools, model, and thinking, project agents override user agents by name, and missing model or thinking inherits the parent.
  - Alternatives: user agents only; inline prompts only; project agents without trust.
  - Consequences: project agents are repo-controlled prompt injection surface; tool allowlists can restrict a child; the subagent tool is removed at the depth cap.
  - Trust and explicit agent definitions make delegation reusable without hiding its scope.

- [x] D100 [R33]: Keep the subagents directory `0700` and JSON, log, session, and socket files `0600`; require project trust to start; load `pi-guard` and core policy in the child; store agent, task, status, PID, start time, socket, session, and attempt, never API keys.
  - Alternatives: loose permissions; session-scoped children; no guard in children.
  - Consequences: prompts and results remain local but readable by the user; cancel and reconciliation need PID/start-time checks; parent exit leaves children running.
  - Durable processes must be traceable and must not bypass policy.

- [x] D101 [R33]: Resume only on an explicit `resume` action; a failed child restarts from its persisted session file with the same logical id, an incremented attempt, and a new runner/socket; there is no auto-resume.
  - Alternatives: auto-resume once; no resume; new id on resume.
  - Consequences: callers choose whether to spend again; the old runner is cleaned up; resume in an untrusted project is denied.
  - Explicit recovery avoids surprise cost and retry loops while preserving durable state.

- [x] D102 [R34]: Document `subagents.json`, agent frontmatter, the action schema, state/socket locations, trust gates, depth/concurrency limits, write locking, recovery, ACP inactivity, the shared process package, and known limitations in the package and root READMEs.
  - Alternatives: code comments only; separate operations guide.
  - Consequences: docs must track default limits and the process/socket layout; users can audit what leaves the machine and what survives.
  - Durable child processes and write locks are hard to reason about without an explicit contract.

- [x] D103 [R35]: Add `packages/process` as `@hollowheap/process`, a Node-only library with no Pi host imports, owning detached spawn, state, PID/start-time reconciliation, logs, cancellation, and Unix socket server/client primitives; `pi-tasks` and `pi-subagents` depend on it.
  - Alternatives: duplicate runners in both extensions; put process code in core; ship another extension.
  - Consequences: `pi-tasks` is refactored onto the shared layer; core stays host-free; the dependency graph gains one package.
  - Two durable subsystems need one lifecycle implementation to avoid cleanup and state drift; this supersedes D65's subagent ownership.

- [x] D104 [R35]: Consumers supply the state directory and socket path; the process package keeps the directory `0700`, files and sockets `0600`, writes state atomically, records PID/start time, appends logs, and speaks one JSON object per line with `{id, action, payload}` request/response envelopes.
  - Alternatives: JSON-RPC 2.0; Node IPC; per-consumer state formats.
  - Consequences: consumers define action names and handlers; the package carries no Pi, agent, or task semantics; reattach clients must correlate request ids.
  - A tiny transport contract is enough for shell tasks and subagent runners without coupling them to ACP.

- [x] D105 [R35]: `pi-subagents` is a new extension owning the parent tool, agent discovery, child-side write lock, and child Pi RPC wiring; it depends on core and the process package. `pi-tasks` keeps shell tasks and migrates its runner/registry primitives to the process package in the same change.
  - Alternatives: extend `pi-tasks` with subagents; keep two lifecycle implementations; leave `pi-tasks` untouched.
  - Consequences: package and dependency updates; task behavior tests must stay green; no duplicate runner.
  - Separate concerns keep shell tasks small while giving subagents their own control surface.

- [x] D106 [R33]: When `PI_ACP` is set, `pi-subagents` registers no tool and never starts local children; ACP execution stays behind the client terminal and fs capabilities.
  - Alternatives: allow local children; route child approvals through the ACP client.
  - Consequences: ACP parity with `pi-tasks`; subagents are CLI-only in v1.
  - ACP clients must remain the only execution path.

## Non-Goals

- A ctags or tree-sitter fallback engine in v1; the first version is LSP-only.
- Hover, diagnostics, rename, formatting, or code actions in v1.
- Auto-installing language servers or resolving them from project-local `node_modules`.
- Project-level `code-intel.json`; server commands come from built-in mappings and the agent dir only.
- Semantic or embedding-based code search.
- A todo model tool; `pi-todos` uses `create_todos`/`complete_todos` tagged blocks only.
- Rewriting the stored assistant message or model transcript to remove tagged blocks.
- A sidebar or split-pane todo panel; Pi overlays composite without reflowing
  the transcript, and the extension API has no split-pane or side placement.
  Todos use a compact above-editor widget, `/todos`, and the status count.
- A combined tabbed question form; questions are sequential dialogs.
- Stored-message stripping or a tool fallback when no UI is available.
- Removing tagged blocks from RPC client transcripts; RPC rendering is client-owned.
- OS-level sandboxing of allowed shell side effects.
- `tool_search` activation of `fd`/`rg`; a mid-session schema append can invalidate the cached prefix.
- A direct-schema fallback when `codemode` is unavailable; the declared set must not depend on the environment.
- A runtime dependency on the ACP SDK; an ACP SDK in core.
- Sharing core state across processes.
- Changing the permissions rule schema beyond adding a `tools` tag map.
- A central subagent hub daemon; durable children use per-child runners and sockets.
- Local subagent execution under ACP or subagent tool calls routed through the ACP client in v1.
- ACP background terminal tasks; ACP keeps `acp_bash` and the client terminal.
- Completion-triggered model turns for background tasks.
- Local durable task starts in untrusted projects.
- Automatic task garbage collection in v1; durable task cleanup is manual.
- Remote or SSH task execution.
- Codemode-only `task` or `subagent` tools.
- Overriding the host built-in `bash` tool or detaching in-flight foreground commands via `/background` (`alt+b`).
- In-process SDK subagents, worktree isolation, auto-resume, recursive depth beyond 3, or central parent-hub routing.
- Automatic monkey-patching of `ctx.ui` to acquire the prompt lock.
- Serializing non-blocking UI surfaces such as status, widgets, headers, or todo lists.

- [x] D107 [R36]: Todos use tool-free tagged blocks and render in a sticky widget above the prompt box sharing the area with subagent execution states (running, blocked, complete); no statusline/dashboard segment.
  - Alternatives: inline chat output only, statusline/footer segment, dashboard panel.
  - Consequences: Shared widget area above prompt box coordinates todos and subagent states; tool-free tagged blocks preserved.
  - A sticky section above the prompt box keeps active work visible without cluttering conversation history or requiring statusline integration.

- [x] D108 [R37]: `/context` lives in the pi-guard slash-command family alongside `/mode` and `/cd`.
  - Alternatives: separate pi-context/pi-utilities extension, core shared command.
  - Consequences: Reuses existing command registration and UI; no new extension package.
  - Co-locating with other slash commands keeps the command surface unified.

- [x] D109 [R38]: Trusted roots are configured per user; untrusted roots fall back to `ask`, with allow/ask/deny decisions persistable for the session or indefinitely.
  - Alternatives: hard deny only, automatic trust of parent directories.
  - Consequences: Requires root-trust storage and a persistence scope on verdicts.
  - User-controlled trust keeps out-of-workspace access explicit and reversible.

- [x] D110 [R39]: pi-budget reads pricing from the configured provider and enforces caps in dollars.
  - Alternatives: static price table, token-only caps.
  - Consequences: Budget logic depends on provider pricing availability; fallback to tokens when missing.
  - Provider pricing keeps budgets aligned with actual billed cost.

- [x] D111 [R39]: A `pi-usage` extension persists cost and token usage across compaction.
  - Alternatives: store usage only in pi-budget, recompute after compaction.
  - Consequences: New extension package; shared state with pi-budget.
  - Persistence prevents loss of cumulative cost on compaction.

- [x] D112 [R40]: `pi-modal` implements a `CustomEditor` with Vim normal/insert/visual modes and loads key overrides exclusively from global `~/.pi/agent/modal.json`.
  - Alternatives: project-level `.pi/modal.json` overrides, hardcoded key bindings without user config.
  - Consequences: Custom editor component replaces default prompt input; users configure one shared Vim keymap globally without project churn.
  - Global user keybindings maintain consistent muscle memory across all repositories.

- [x] D113 [R41]: Subagent model failures query Pi's active runtime models and prompt an interactive swap via `ctx.ui.select`, while callers remain barred from model overrides.
  - Alternatives: silent subagent failure, hardcoded static fallback lists, allowing callers to pass arbitrary models in tool inputs.
  - Consequences: Dynamic runtime model list + current session model fallback guarantees usable replacement options; callers cannot override frontmatter models; sequenced as the immediate first vertical task.
  - User steering maintains execution continuity when free or experimental models experience outages.

- [x] D114 [R42]: `pi-web` exposes `web_search` and `web_fetch` exclusively with `exposure: "codemode"`, and core pricing treats `:free` models as $0.00.
  - Alternatives: dual direct/codemode exposure, declaring tools in LLM prompt by default.
  - Consequences: Tools are callable only within QuickJS scripts; prompt tokens are saved; free models evaluate to $0.00 without NaN.
  - Pure codemode execution eliminates LLM prompt overhead and enables multi-step research loops in a single turn.

- [x] D115 [R43]: Dedicated `pi-agent` extension owns `/agent` slash command, auto-forking, branch labeling, and skill filtering.
  - Alternatives: Keep `/agent` in `pi-subagents`, make `/agent` a simple persona switcher without session forking, filter skills by unloading extension modules.
  - Consequences: `pi-subagents` stays focused strictly on child process execution; switching agents automatically creates a branch in the session tree (`agent: <name>`) and renames the session `[<agent>] <title>`; skill filtering dynamically restricts `event.systemPromptOptions.skills` without altering extension registrations; modal overlay popup presents agent details.
  - Distinct agent roles require isolated system prompts, tailored skills, and branched session histories to maintain conversational and architectural integrity.

- [x] D116 [R44]: Parent session mode takes priority over subagent frontmatter mode, and `pi-todos` renders live subagent progress `@<id> <elapsed> (<task>) <state> · <tool> <duration>` driven by `subagents:state` events.
  - Alternatives: subagent always uses frontmatter mode, child prompts separately, todo widget shows static status text only.
  - Consequences: Non-default parent modes (`autopilot`, `plan`, `edit`) force child into matching constraints/automation; `ask` parents allow frontmatter mode; `pi-guard` treats read-only subagent actions as passthrough; child hooks track active tool and elapsed duration; 1-second interval ticker refreshes widget.
  - Parent session intent governs automation scope, while live progress in the sticky prompt widget gives immediate visibility without separate polling.

- [x] D117 [R45]: Budget displays as `$0.012` (usage only) or `$0.012/$1.000` (cap active) in `pi-statusline`, while `pi-budgets` provides a detailed breakdown panel and discontinues `ctx.ui.setStatus("budget")`.
  - Alternatives: Keep verbose footer string, show budget only inside todo widget, token counts only in statusline.
  - Consequences: Statusline gains simple ratio/usage rendering; `pi-budgets` emits structured metrics for statusline and panel; verbose default footer is silenced.
  - A compact statusline element keeps cost constantly observable without distracting footer changes.

- [x] D118 [R46]: `ModalEditor` tracks anchor and active cursor offsets to render visual selection highlighting and executes yank/cut/change using terminal clipboard utilities.
  - Alternatives: rely on native terminal mouse selection, pass shift-arrow escape sequences to underlying editor.
  - Consequences: Editor maintains internal visual selection range; `render()` styles highlighted characters with selection background; `y`, `d`, `x`, `c` operate on selection range.
  - Vim visual mode requires character-exact in-buffer selection tracking to work reliably in raw terminal mode.

- [x] D119 [R47]: Prompt decoration adds a configurable `promptChar` (default `'❯'`) to `modal.json`, and all bordered components adopt Unicode rounded box-drawing characters (`╭`, `╮`, `╯`, `╰`).
  - Alternatives: keep sharp 90-degree corners, allow arbitrary string prefixes, hardcode prompt characters without user configuration.
  - Consequences: `pi-modal`, `pi-todos`, `pi-agent` popup, and any future bordered widgets share rounded box framing; `modal.json` adds `promptChar: string`.
  - Unified rounded borders give cohesive visual identity across extensions while single-character prompt decoration prevents layout breakage.

- [ ] D120 [R48]: Sandboxing uses `bwrap` (Bubblewrap) to isolate shell execution with read-only root and workspace-only writable bind mounts.
  - Alternatives: Podman rootless container exec, Docker container wrapper, Landlock/seccomp native Node bindings.
  - Consequences: Uses host `bwrap` binary without daemon requirements; maps workspace directory read-write; isolates `~/.ssh`, `~/.gnupg`, and host dotfiles.
  - Bubblewrap provides instant sub-10ms startup, unprivileged namespace isolation, and zero background daemon maintenance.

- [ ] D121 [R49]: `pi-todos` introduces `delete_todos` block requiring all items to be marked complete before execution, and adds `/todo delete [id]` and `/todo complete <id>` user commands.
  - Alternatives: allow agent to delete incomplete items, require user confirmation prompt on every deletion, allow only complete without delete.
  - Consequences: Parser enforces completion precondition for `delete_todos`; slash commands `/todo delete [id]` and `/todo complete <id>` give user full manual control.
  - Requiring all items to be complete before agent deletion ensures tasks are not lost mid-flight while users retain immediate manual override.

- [ ] D122 [R50]: `pi-todos` implements a `^x p` (`Ctrl+X` then `p`) prefixed keybinding handler and `/panel toggle` command to collapse/expand sticky panels, and unifies task and subagent widget layouts.
  - Alternatives: single un-prefixed hotkey, slash command only, separate toggle keys per section.
  - Consequences: Prefix chord state machine intercepts `^x` then `p` in raw keyboard input; widget can collapse to zero lines; task and subagent rows share `@<id> <elapsed> (<task>) <status> · <action> <duration>` format.
  - Prefixed hotkeys avoid colliding with text input or standard editor keybindings while unified row formatting minimizes visual cognitive load.



