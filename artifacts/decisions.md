# Decisions

Settled decisions. Canonical line: `Dxx [Rxx]: decision`, followed by context, alternatives, consequences, architecture, resolution, supersession, and verification.

### System Shape

- [x] D16 [R11]: The bundled extension consumes core and deletes its vendored policy files
  - Context: TUI and ACP must agree on modes and permissions.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D17 [R11]: Spawn adds `-nbt` so built-in read/write/edit/bash cannot run behind the client's back
  - Context: ACP fs/terminal capabilities must be the only execution path.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D18 [R11]: ACP lifecycle: close the previous live session before reload and on startup failure; register prompt handlers before dispatch; reject pending prompts/permissions/clients on exit/close; push mode on connect and buffer pre-handshake sets
  - Context: leaks and dropped turns today.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D19 [R11]: Permission requests carry the real pi tool-call id; terminal polling is wall-clock bounded; timed-out client RPCs delete pending entries
  - Context: client correlation and leak-free timeouts.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D20 [R11]: `acp_write` creates parent dirs, `acp_edit` refuses buffer/disk drift and missing files, `acp_fd`/`acp_rg` terminate flags with `--`, `acp_eza` verifies a directory
  - Context: match `SYSTEM_APPENDIX` promises and block flag injection.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D65 [R20]: A new `extensions/pi-tasks` extension owns durable task lifecycle, the task registry, and the direct `task`/future `subagent` tools while keeping the host built-in `bash` tool untouched; `pi-tools` stays stateless and core gains no process or host code
  - Context: persistence, trust, and cleanup need one lifecycle owner, while keeping built-in `bash` avoids reimplementing foreground shell execution.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D66 [R20]: `task` and the future `subagent` tool are direct tools; `lang` stays codemode
  - Context: essential orchestration must always be visible and callable, while auxiliary navigation can stay out of the direct schema.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D67 [R20]: `pi-tasks` keeps the built-in `bash` tool untouched (no `/background` or `alt+b` mid-flight detach) and starts background shell commands explicitly through `task({ action: "start", command })`; `pi-guard` gates `task` (`action === "start"` as `tag: "shell"` against `command`, while read-only `list`/`status`/`wait` and `cancel` pass without a shell prompt) and `pi-hooks` sees `task` tool calls
  - Context: deciding up front whether a command runs in the background avoids reimplementing Pi's foreground `bash` tool while preserving full `pi-guard` shell policy and user confirmation on `task.start`.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D68 [R20]: The `task` tool supports `start`, `list`, `status`, `wait`, and `cancel`; `wait` blocks until exit or timeout (including across pi restarts via the task state file); completion does not trigger a turn
  - Context: explicit `start` on `task` keeps background orchestration on a single tool, the agent stays in control of when to wait, and background work must not inject unsolicited model turns.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D69 [R20]: Durable shell tasks survive pi exit via a detached Node runner shim that streams output to `<agentDir>/tasks/<id>.log` and writes exit state to `<agentDir>/tasks/<id>.json` (both `0600`), start only in trusted projects, and are cleaned up manually; `list`/`status`/`wait` reconcile dead shims using recorded PID plus process start time to prevent PID-reuse false positives, and `session_shutdown` leaves them running
  - Context: a detached shim records exit status even when pi is closed, start-time checks prevent OS PID reuse bugs, and project trust plus `0600` files bound the risk of outliving the session.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D70 [R20]: The task layer is generic in v1: a task record has `id`, `kind`, `status`, `cwd`, `startedAt`, `finishedAt`, `exitCode`, `output`, `wait`, and `cancel` (`shell` is the first kind); `inbox`/`outbox` are deferred until the subagent RPC spec defines the message envelope
  - Context: subagents share the lifecycle and wait/cancel seam now, while deferring message queues avoids dead fields before the parent-hub protocol exists.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D71 [R20]: Subagents are session-scoped and use parent-hub routing between RPC child processes; only shell tasks are durable; no hub daemon
  - Context: a parent hub cannot route after the parent exits, and a durable daemon adds trust and lifecycle complexity before the subagent feature exists.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D72 [R20]: ACP mode keeps `acp_bash` and the client terminal; the `pi-tasks` local task tool is inactive there
  - Context: ACP command execution must stay behind the client terminal capability, and local background processes would bypass it.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D95 [R30]: Run each subagent as a detached `pi --mode rpc` child supervised by a per-child runner built on `@hollowheap/process`; the runner owns stdio, exposes a Unix socket for live reattach/steer, and persists state, logs, and session files under `<agentDir>/subagents/`; no central daemon.
  - Context: Live steering plus durable children need a process that owns the child after the parent exits; a per-child runner avoids a daemon.
  - Alternatives: in-process SDK sessions; central parent-hub daemon; session-scoped children.
  - Consequences: children outlive the parent; live reattach needs socket and state reconciliation; one runner and socket per child; supersedes D71's session-scoped parent-hub design.

- [x] D96 [R30]: Expose one direct `subagent` tool with `start`, `list`, `status`, `send`, `wait`, `cancel`, and `resume` actions; one child per `start`, no parallel-array parameter, and concurrency comes from multiple calls plus config.
  - Context: One child per call keeps failure attribution and write-lock ownership clear.
  - Alternatives: a parallel tasks array; single-call-only tool; separate prompt/steer tools.
  - Consequences: the parent model tracks ids; the schema has lifecycle actions; `send` steers a running child and prompts an idle one.

- [x] D97 [R31]: Read `<agentDir>/subagents.json` for `maxConcurrent` (default 4, max 8), `maxDepth` (default 1, max 3), `defaultTimeoutMs` (default 30 minutes, max 24 hours, 0 disables), and `writeLockTimeoutMs` (default 30 seconds); invalid values diagnose and fall back.
  - Context: Defaults must be safe without configuration, while allowing tuned concurrency and recursion.
  - Alternatives: hardcoded limits; per-call limits only; no timeout.
  - Consequences: config is shared by parent and children; depth is passed through the child environment; limits bound cost and process growth.

- [x] D98 [R31]: Serialize `write`, `edit`, and `bash` across child processes with a per-tool lock at `<agentDir>/subagents/write.lock`; atomic directory creation records owner PID and start time, the child extension releases on tool result, error, abort, or timeout, and stale owners are reclaimed.
  - Context: Per-tool locking preserves concurrency without letting two children mutate the same tree.
  - Alternatives: one write-lease per child lifetime; cap all children to one; worktrees per child.
  - Consequences: read-only children proceed in parallel; writers wait; denied or crashed calls need release handling; lock wait is bounded.

- [x] D99 [R32]: Load agents from `<agentDir>/agents/*.md` and, only for trusted projects, `<project>/.pi/agents/*.md`; frontmatter supplies name, description, tools, model, and thinking, project agents override user agents by name, and missing model or thinking inherits the parent.
  - Context: Trust and explicit agent definitions make delegation reusable without hiding its scope.
  - Alternatives: user agents only; inline prompts only; project agents without trust.
  - Consequences: project agents are repo-controlled prompt injection surface; tool allowlists can restrict a child; the subagent tool is removed at the depth cap.

- [x] D100 [R33]: Keep the subagents directory `0700` and JSON, log, session, and socket files `0600`; require project trust to start; load `pi-guard` and core policy in the child; store agent, task, status, PID, start time, socket, session, and attempt, never API keys.
  - Context: Durable processes must be traceable and must not bypass policy.
  - Alternatives: loose permissions; session-scoped children; no guard in children.
  - Consequences: prompts and results remain local but readable by the user; cancel and reconciliation need PID/start-time checks; parent exit leaves children running.

- [x] D101 [R33]: Resume only on an explicit `resume` action; a failed child restarts from its persisted session file with the same logical id, an incremented attempt, and a new runner/socket; there is no auto-resume.
  - Context: Explicit recovery avoids surprise cost and retry loops while preserving durable state.
  - Alternatives: auto-resume once; no resume; new id on resume.
  - Consequences: callers choose whether to spend again; the old runner is cleaned up; resume in an untrusted project is denied.

- [x] D102 [R34]: Document `subagents.json`, agent frontmatter, the action schema, state/socket locations, trust gates, depth/concurrency limits, write locking, recovery, ACP inactivity, the shared process package, and known limitations in the package and root READMEs.
  - Context: Durable child processes and write locks are hard to reason about without an explicit contract.
  - Alternatives: code comments only; separate operations guide.
  - Consequences: docs must track default limits and the process/socket layout; users can audit what leaves the machine and what survives.

- [x] D103 [R35]: Add `packages/process` as `@hollowheap/process`, a Node-only library with no Pi host imports, owning detached spawn, state, PID/start-time reconciliation, logs, cancellation, and Unix socket server/client primitives; `pi-tasks` and `pi-subagents` depend on it.
  - Context: Two durable subsystems need one lifecycle implementation to avoid cleanup and state drift; this supersedes D65's subagent ownership.
  - Alternatives: duplicate runners in both extensions; put process code in core; ship another extension.
  - Consequences: `pi-tasks` is refactored onto the shared layer; core stays host-free; the dependency graph gains one package.

- [x] D104 [R35]: Consumers supply the state directory and socket path; the process package keeps the directory `0700`, files and sockets `0600`, writes state atomically, records PID/start time, appends logs, and speaks one JSON object per line with `{id, action, payload}` request/response envelopes.
  - Context: A tiny transport contract is enough for shell tasks and subagent runners without coupling them to ACP.
  - Alternatives: JSON-RPC 2.0; Node IPC; per-consumer state formats.
  - Consequences: consumers define action names and handlers; the package carries no Pi, agent, or task semantics; reattach clients must correlate request ids.

- [x] D105 [R35]: `pi-subagents` is a new extension owning the parent tool, agent discovery, child-side write lock, and child Pi RPC wiring; it depends on core and the process package. `pi-tasks` keeps shell tasks and migrates its runner/registry primitives to the process package in the same change.
  - Context: Separate concerns keep shell tasks small while giving subagents their own control surface.
  - Alternatives: extend `pi-tasks` with subagents; keep two lifecycle implementations; leave `pi-tasks` untouched.
  - Consequences: package and dependency updates; task behavior tests must stay green; no duplicate runner.

- [x] D106 [R33]: When `PI_ACP` is set, `pi-subagents` registers no tool and never starts local children; ACP execution stays behind the client terminal and fs capabilities.
  - Context: ACP clients must remain the only execution path.
  - Alternatives: allow local children; route child approvals through the ACP client.
  - Consequences: ACP parity with `pi-tasks`; subagents are CLI-only in v1.

- [x] D113 [R41]: Subagent model failures query Pi's active runtime models and prompt an interactive swap via `ctx.ui.select`, while callers remain barred from model overrides.
  - Context: User steering maintains execution continuity when free or experimental models experience outages.
  - Alternatives: silent subagent failure, hardcoded static fallback lists, allowing callers to pass arbitrary models in tool inputs.
  - Consequences: Dynamic runtime model list + current session model fallback guarantees usable replacement options; callers cannot override frontmatter models; sequenced as the immediate first vertical task.

- [x] D116 [R44]: Parent session mode takes priority over subagent frontmatter mode, and `pi-todos` renders live subagent progress `@<id> <elapsed> (<task>) <state> · <tool> <duration>` driven by `subagents:state` events.
  - Context: Parent session intent governs automation scope, while live progress in the sticky prompt widget gives immediate visibility without separate polling.
  - Alternatives: subagent always uses frontmatter mode, child prompts separately, todo widget shows static status text only.
  - Consequences: Non-default parent modes (`autopilot`, `plan`, `edit`) force child into matching constraints/automation; `ask` parents allow frontmatter mode; `pi-guard` treats read-only subagent actions as passthrough; child hooks track active tool and elapsed duration; 1-second interval ticker refreshes widget.

- [x] D124 [R52]: `pi-tasks` adds `/task logs <id>` for live output tailing and dependency declarations in task start.
  - Context: Observable output and ordering enable multi-step automation workflows.
  - Alternatives: auto-stream all output, external log files, task groups.
  - Consequences: Task registry stores log buffer per task; dependencies block start until prerequisite completes; circular deps rejected.

- [x] D127 [R55]: `pi-subagents` adds `/subagent pause <id>`, `/subagent resume <id>`, and parent steering via follow-up message.
  - Context: Pause and steer let users course-correct without losing subagent context.
  - Alternatives: kill and restart, external control, no steering.
  - Consequences: Pause sends abort to child process; resume restarts with persisted session; steering queues a message for next turn.

- [x] D141 [R20] [R30] [R35]: `pi-tasks` is the foundation for durable task lifecycle. It exports `TaskStore` for atomic state/log access and `spawnDetachedTask` for detached spawn plus PID/start-time persistence; `pi-subagents` depends on `@hollowheap/pi-tasks` and uses both for subagent state and runners.
  - Context: One lifecycle owner prevents state, locking, and reconciliation drift between shell tasks and subagents.
  - Alternatives: duplicate lifecycle code in each extension; move primitives into another package; keep D105 ownership split.
  - Consequences: this supersedes D105 and S105; `pi-tasks` stays a Pi extension while exposing host-free lifecycle modules, and `pi-subagents` owns only subagent-specific control, agents, policy, and its detached JS shim's minimal atomic write.

- [x] D142 [R30]: `pi-subagents` supports named generic CLI harnesses from `subagents.json` plus `harness` in agent frontmatter. Pi remains the default JSONL/RPC harness; generic harnesses receive the system prompt and task as plain stdin or argument input, use raw-text steering, and reuse task state, wait, cancel, and resume.
  - Context: A configurable command seam covers other CLIs without hardcoding vendor flags.
  - Alternatives: only Pi children; hardcoded Claude/Codex adapters; ACP-only harnesses; external adapter plugins.
  - Consequences: generic harnesses do not load `pi-guard`, the child write lock, or Pi session continuation; `resume` re-runs the saved task; `input` is `stdin` or `arg`, with `{prompt}` substitution when present.

- [x] D152 [R54] [R68]: `pi-usage` obtains subagent usage by scanning Pi child session JSONL files under `<agentDir>/subagents/`, keyed by subagent id and filtered by a parent-session id stored in subagent state. It reports per-subagent rows and rolls the same values into totals, per-model costs, and the USD cap. Refresh happens when a child leaves the active state set and before the parent starts its next turn; running children are skipped. Generic CLI harnesses report usage unavailable and are excluded from totals.
  - Context: see the linked requirements and consequences.
  - Alternatives: emit usage snapshots from `pi-subagents`; make children write a usage ledger; include all subagents on disk; include subagent spend in totals but not the cap; refresh by polling every second.
  - Consequences: `pi-subagents` gains a `parentSession` field; `pi-usage` owns child-session parsing and defensive file/JSON validation; failed and cancelled Pi children still count their recorded spend; a child can exceed the cap while running, but the next parent run is blocked; generic harness rows remain visible with unknown usage.

- [x] D160 [R71]: Add opt-in isolated workspaces for concurrent tasks and subagents; keep the single-writer lock as the default.
  - Context: Q11 selected opt-in isolation; the current lock is safe but serializes writers, while automatic isolation would add merge and cleanup risk.
  - Alternatives: write lock only; isolate subagents only; isolation by default.
  - Consequences: a workspace allocator and lifecycle are needed; integration and cleanup are explicit; the default single-writer path is unchanged; no automatic merge.
  - Resolves: Q11

- [x] D161 [R30]: Keep the local subagent runner for generic CLI harnesses and add a thin adapter that maps upstream Pi subagent RPC/events into `subagents:state`; do not fork upstream.
  - Context: Q13 probe found upstream can feed the panel without a fork, but it redacts task text, omits foreground runs, and does not launch generic harnesses.
  - Alternatives: adopt upstream Pi-only and remove the local runner; harden the local runner only; defer the adapter.
  - Consequences: the adapter listens to upstream readiness/events and calls `status`; snapshots map to local state items; the local runner remains for generic harnesses; duplicate `subagent` tool registration is guarded; no upstream fork.
  - Resolves: Q13

- [x] D163 [R71]: Opt-in isolated workspaces use a host-free shared workspace module in `packages/core`, consumed by `pi-tasks` and `pi-subagents`; the single-writer lock remains the default.
  - Context: The user chose core as the shared home; workspace allocation, integration, and cleanup should not be duplicated in each consumer.
  - Alternatives: `pi-tasks` primitives; new workspace package; no isolation.
  - Consequences: core gains workspace allocation, integration, and cleanup primitives; consumers call the shared module; no automatic merge; the default lock is unchanged.

- [x] D164 [R73]: Add an optional `isolated` start parameter to task and subagent tools; allocate a core workspace, use it as cwd, and clean it on terminal states or cancel.
  - Context: The core allocator and consumer helpers exist; wiring the optional tool parameter makes opt-in isolation reachable without changing defaults.
  - Alternatives: separate isolation tool; config-only global switch; no tool surface.
  - Consequences: task/subagent start schemas gain `isolated?: boolean`; metadata tracks the workspace; cleanup runs on completed, failed, or cancelled; omitted/false uses the shared cwd.

### Module Seams

- [x] D01 [R08]: `@hollowheap/core` becomes the runtime owner of rule parsing, permission-rule loading/caching (`<agentDir>/permissions.json` plus a trusted project overlay), path matching, and shell command analysis
  - Context: one implementation for TUI and ACP; vendored copies drift.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D02 [R08]: Core also owns the mode registry, active session mode, and virtual cwd via session-scoped stores
  - Context: replaces cross-package event query mutations that depend on load order.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D03 [R08]: Shared state lives on `globalThis[Symbol.for("@hollowheap/core/state")]`, not module scope
  - Context: the loader uses `moduleCache: false` and separate module roots per installed package, so module-level state is duplicated.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D04 [R08]: Core is a real `dependencies` entry for consumers (installed by pi with the package), remains free of `@earendil-works/*`/`typebox` imports, and is the single documented exception to the no-bare-imports rule
  - Context: runtime import must resolve after `pi install`; host modules stay the only other exception.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D05 [R08]: Shared primitives: bounded subprocess runner (abort, exit-code allowlist, ENOENT/cwd diagnostics), mtime-cached JSON config with once-per-change diagnostics, output truncation, path/target formatting
  - Context: removes three exec copies and four policy copies.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D12 [R10]: `pi-guard` keeps TUI prompting, truncation, `/mode`, `alt+m`, statusline value; all policy code moves to core
  - Context: single owner, consumer stays thin.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D13 [R10]: `pi-budgets` owns the autopilot entry gate (no cap → veto) and cap abort; `pi-autopilot` only registers the layer
  - Context: keeps budget policy in the budget package.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D14 [R10]: `pi-tools` writes `/cd` and reads effective cwd through core so it works without `pi-guard`; search results keep `ask` paths and drop only `deny`
  - Context: current filtering returns empty results on ask-configured paths.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D15 [R10]: `pi-guard`/`pi-tools`/`pi-acp` never prompt for unknown tools on the ACP path without a client
  - Context: no client means no approver; deny is the safe outcome.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D21 [R12]: Statusline renders extension segments through the component/pill pipeline and truncates left-first so right-pinned sections stay visible
  - Context: extension segments currently look different and the right side is cut.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D22 [R12]: Dashboard aborts in-flight periodic commands on stop/shutdown and keeps width dynamic
  - Context: no work after shutdown; narrow terminals must fit.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D35 [R15]: A hook runs a shell command; pi-hooks passes the tool call JSON on stdin and reads the decision from stdout
  - Context: one mechanism that works for any language, and it lets the model author hooks such as "after every Edit, run the tests" without writing an extension.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D36 [R15]: Hooks are configured in `<agentDir>/hooks.json`, plus `<project>/.pi/hooks.json` loaded only when the project is trusted
  - Context: matches the permissions overlay (D29) and pi's own trust model, so a clone cannot install hooks of its own.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D37 [R15]: A pre-tool hook may only block the call with a reason or let it proceed; it never rewrites the tool arguments
  - Context: a hook that silently redirects a call hides the change from both the model and the user.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D38 [R15]: A post-tool hook appends its output to the tool result, so the model sees it
  - Context: that is what makes "run the tests after each edit" useful, and appending cannot hide output the model needs.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D39 [R15]: The model configures hooks through a skill alone, writing the JSON with the file tools it already has; pi-hooks adds no model-callable tool
  - Context: the schema is teachable in prose, and a config tool would add a second way to install commands that run on every tool call.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D40 [R15]: A pre-hook that fails or times out blocks the call, with the failure as the reason
  - Context: a broken enforcement hook must not silently allow the call; the reason tells the user what to fix or disable.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D41 [R15]: The default skill ships inside the pi-hooks package and is contributed through pi's `resources_discover` event (opt-in via `PI_HOOKS_DISCOVER_SKILL=1` to avoid prompt noise)
  - Context: a package's `skills/` directory is only discovered for installed packages, so a local `pi -e ./extensions/pi-hooks` run would miss the skill; `resources_discover` is the only extension-level route and is the pattern pi's own example uses. Disabled by default to keep the session prompt minimal.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D42 [R16]: `fd` and `rg` register with `exposure: "codemode"`, and installs keep `tool_search` disabled
  - Context: scripts keep both callable without changing the declared tool set, and listing them in the codemode description avoids a discovery round while the prefix stays stable; `tool_search` also searches `codemode`-exposure tools, so enabling it would activate `fd`/`rg` mid-session and mutate the prefix.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D43 [R16]: `pi-tools` activates the registered `codemode` tool on every `session_start`, including reload, and its README documents that behavior
  - Context: codemode exposure is otherwise unreachable; auto-activation plus documentation was chosen over a direct-schema fallback, and reload re-activation keeps a newly loaded `pi-tools` reachable.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D44 [R17]: `pi-question` stops registering a model tool; the model emits tagged fenced blocks in assistant text, and the extension reads them on `message_end`
  - Context: the user wants questions to be part of the response format, not a tool call, so the model can ask without a tool schema or a tool-result round trip.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D45 [R17]: `@hollowheap/core` owns a host-free tagged-block scanner and minimal markdown AST (H2, ordered/unordered list, checkbox, paragraph); `pi-question` owns the `question` tag parser, dialogs, prompt section, and answer message
  - Context: the scanner is reusable by future `create_todos`/`complete_todos` handlers while core stays free of host imports (D04).
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D46 [R17]: Fence syntax is `'''<tag>` at line start through a closing `'''`; a `question` body uses one H2 per question and an ordered list of options; every option prefixed `[ ]` (or `[x]`) means multi-select, no checkbox means single-select; the UI always appends the final write-in option, and the model must not write one
  - Context: the delimiter does not collide with backtick code fences, and checkbox presence is the least verbose mode marker.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D47 [R17]: TUI uses sequential dialogs: single-select through `ctx.ui.select` plus `ctx.ui.input` for write-in; multi-select through a custom checkbox dialog with inline write-in; RPC uses `ctx.ui.select` for single and a select-loop with toggle rows plus Done for multi; print/json get no question contract
  - Context: `custom()` is unavailable in RPC, while `select`/`input` are supported there; sequential dialogs match the chosen per-question flow.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D48 [R17]: The question format reaches the model through a stable `before_agent_start` system-prompt section (`systemPromptOptions.sections.question_format`) only when `ctx.hasUI`
  - Context: a system-prompt section is the host's intended contract mechanism and stays out of print/json modes where the model could not get an answer.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D49 [R17]: The raw block is removed from TUI display only, via `registerMarkdownTransformer` for assistant messages; the stored assistant message and model context keep it. Collected answers return as a custom `hollowheap.question.answers` message with `display: true` and `deliverAs: "followUp"`, listing numbered answers only
  - Context: display-only stripping avoids mutating the model transcript, and the retained fence lets the model map numbered answers without quoting the questions again.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D50 [R17]: Cancelling any dialog cancels the whole set, sends no follow-up, and leaves the fence in context; there is no tool fallback
  - Context: a partial answer set would be ambiguous, and the user chose silent cancellation.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D51 [R17]: The `question` tool and its TypeBox/pi-ai dependencies are removed; `pi-question` adds `@hollowheap/core` as a real dependency, and the breaking removal is documented. Package version bumps are deferred to the next coordinated release
  - Context: the feature is a breaking API change, but bumping only `pi-question` would break the workspace `^0.2.0` core dependency; a coordinated release handles the version move.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D52 [R17]: `pi-question` handles and display-strips only valid `question` blocks; unknown tags and fully closed malformed question blocks are left untouched and visible, while an open question fence may be hidden during streaming, with no crash
  - Context: future tag handlers need the scanner without this extension stealing their blocks, and a malformed block should remain diagnosable rather than disappear.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D53 [R17]: A question has 0–8 options (0 means free-text only), the write-in answer is capped at 500 characters, and multiple H2 questions are asked one after another in source order
  - Context: the write-in makes 0 options useful, the cap matches the old tool, and sequential order keeps the dialog flow predictable.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D54 [R18]: A new `extensions/pi-todos` extension owns `create_todos`/`complete_todos` parsing, session state, the `todos_format` prompt section, `/todos`, and the status count; it registers no model tool, and core exposes only the scanner/AST
  - Context: mirrors pi-question's boundary, keeps todo state/UI cohesive, and keeps core host-free (D04).
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D55 [R18]: Todo state is a session custom entry (`hollowheap.todos`) on the active branch, restored on session start; create appends and complete marks done, with no global or project-file state
  - Context: resume and fork stay correct, and sessions do not leak into each other.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D56 [R18]: `create_todos` uses an ordered list of task texts and appends; the extension assigns stable numeric IDs; `complete_todos` uses an ordered list of numeric IDs; one follow-up confirmation surfaces the full list with IDs
  - Context: append avoids destructive replacement, IDs are stable for completion, and the model learns IDs without a tool result.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D57 [R18]: `/todos` lists every todo with its ID and done marker; `ctx.ui.setStatus("todos", ...)` shows open/total
  - Context: the command is discoverable, and the count is glanceable without consuming transcript space.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D58 [R18]: Todo blocks and the `todos_format` prompt section are active only when `ctx.hasUI` is true; TUI and RPC process them, while print/json add no section and ignore blocks
  - Context: matches the question gating and the UI-only `/todos`/status surface, so non-interactive runs get no hidden state.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D59 [R18]: The TUI transcript strips valid todo blocks only; the stored message and model context keep the raw fence, RPC clients still receive it, and unknown tags or fully closed malformed blocks stay visible
  - Context: consistent with D49/D52 and keeps malformed output diagnosable.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D60 [R18]: A compact `todos` widget above the editor lists up to five open todos with their IDs, adds `+N more (/todos)` when capped, omits completed todos, and clears when none remain; `/todos` keeps the full list and the status count stays
  - Context: a widget participates in layout, so it reflows the transcript instead of covering it like an overlay.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D76 [R01]: A new `extensions/pi-web` extension owns provider adapters, normalization, key/config loading, URL safety, and both tools; `pi-tools` stays local and stateless.
  - Context: Network providers and their failure modes need one lifecycle owner, while the local search package should not grow HTTP clients.
  - Alternatives: extend `pi-tools`; split search and fetch packages.
  - Consequences: one more package in the suite and one more config surface.

- [x] D77 [R01] [R02]: `web_search` and `web_fetch` are direct tools, not codemode tools.
  - Context: Each is usually one call; hiding them behind a script repeats the `fd`/`rg` mistake.
  - Alternatives: one `web` action tool; codemode-only.
  - Consequences: two more direct tool schemas; better discoverability and fewer round trips.

- [x] D78 [R02] [R03]: Each provider has its own adapter, and all adapters normalize into one search shape and one fetch shape. V1 capabilities: Tavily search + extract, Exa search + contents, Firecrawl search only; Jina is excluded because its free tokens are non-commercial.
  - Context: Provider payloads differ enough that a generic mapper would be fragile; capability flags keep fetch free of a browser dependency.
  - Alternatives: one generic JSON mapper; four separate tools; include Jina with a licensing caveat.
  - Consequences: three keyed adapters plus a raw fallback; adding a provider does not change the tool contract.

- [x] D79 [R02] [R03]: Search results normalize to `title`, `url`, `snippet`, `provider`; fetch results normalize to `url`, `finalUrl`, `provider`, `contentType`, `content`, `links`, `media`, `truncated`. `links` entries are `{url, text?}` and cap at 50; `media` entries are `{url, kind, alt?, mimeType?}` with `kind` one of `image`, `video`, `audio`, `pdf`, `other` and cap at 20. Search defaults to 5 results and caps at 10; fetch defaults to 20k characters and caps at 100k; provider requests time out at 15s.
  - Context: Bounded output keeps context use predictable, and the same shape lets fallback stay invisible to the model.
  - Alternatives: per-provider result shapes; uncapped output; larger defaults; no media metadata.
  - Consequences: adapters may discard provider-specific fields in v1; media is metadata only.

- [x] D80 [R04]: Provider selection is automatic by key presence using a fixed cheapest-first order, with `web.json` able to override each order array; the first entry is the default. Default search order is Exa, Tavily, Firecrawl; default fetch order is Exa, Tavily, then raw HTTP. A provider failure falls through to the next entry.
  - Context: Zero-config when one key is set, deterministic when several are set, cheapest free-tier usage first, and still overridable.
  - Alternatives: explicit provider only; config order only; Tavily-first order.
  - Consequences: a failing primary can add latency before fallback; order must be documented; credit math changes should be handled by config.

- [x] D81 [R04]: Keys come only from environment variables: `TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`. `web.json` never stores keys; it only contains order arrays. Keys are never logged or included in errors.
  - Context: Env is supplied by the user's config layer and keeps secrets out of a JSON file.
  - Alternatives: keys in web.json; host settings namespace.
  - Consequences: standalone users must export keys; no key file to protect.

- [x] D82 [R03]: V1 does not expose headless-browser or JavaScript rendering. Firecrawl is search-only; fetch uses Tavily Extract, Exa Contents, then a dependency-free raw HTTP and HTML-to-text fallback.
  - Context: Rendering adds a browser stack, heavier failures, and a larger security surface; static extraction covers docs and most reference pages.
  - Alternatives: Firecrawl scrape; Browserless; Playwright; Jina Reader.
  - Consequences: JS-only pages may return empty or incomplete content; the limitation must be documented.

- [x] D83 [R05]: `web_fetch` accepts only `http`/`https`, rejects loopback, private, link-local, and metadata targets on every redirect hop, and caps redirects at 5. DNS-rebinding hardening is deferred.
  - Context: Basic SSRF protection is mandatory for a URL tool; full DNS pinning is more code than v1 needs.
  - Alternatives: no filtering; full DNS resolution and address pinning.
  - Consequences: hostnames resolving to private addresses may still pass; document the residual risk.

- [x] D84 [R06]: `pi-guard` maps `web_search` to `search` and `web_fetch` to `read` in its built-in tag map; the user `tools` map cannot override built-ins.
  - Context: Web tools should work without extra config while still respecting path/search policy; built-in safety stays authoritative.
  - Alternatives: require every user to add tags; allow overrides.
  - Consequences: users who want a different tag need a guard code change, not config.

- [x] D85 [R07]: The package README, root README, and suite entry document the three keyed providers, the raw fallback, free-tier caveats, env key names, `web.json` order arrays, normalized shapes, caps, fallback order, media metadata, and the no-rendering limitation.
  - Context: Provider terms and limits change; the user must be able to audit what leaves the machine.
  - Alternatives: provider docs only.
  - Consequences: README maintenance when free tiers change.

- [x] D86 [R02] [R03]: V1 adds no separate response cache. The session transcript already exposes earlier tool results to the model; a tool-level cache is deferred until repeated identical calls prove common.
  - Context: An extra cache adds invalidation and privacy surface without changing what the model can already see.
  - Alternatives: 5-minute in-memory cache; on-disk cache.
  - Consequences: repeated identical provider calls still cost quota.

- [x] D87 [R03]: `web_fetch` returns Markdown content plus extracted links and media metadata; it never returns binary payloads or image blocks.
  - Context: Metadata keeps the tool useful for media-heavy pages without blowing context or adding download cleanup.
  - Alternatives: image blocks; download to temp files.
  - Consequences: the model cannot inspect image pixels or PDF bytes through this tool.

- [x] D88 [R23]: `pi-decide` exposes one direct `decide` tool with one question per call. `kind` is `choice`, `score`, or `bool`; `choice` takes 2–10 `{label, description}` options, `score` takes an ordered 2–10 scale, and `bool` takes `true`/`false` descriptions. The tool returns the label/score/probability, confidence, model, and usage; it returns no free-form rationale.
  - Context: The classifier primitives already provide choice, score, and bool; a rationale would require a different model path.
  - Alternatives: multiple questions per call; separate `decide` and `classify` tools; chat model with rationale.
  - Consequences: callers repeat calls for multiple questions; output stays structured and cheap.

- [x] D89 [R24]: Model selection is explicit in `<agentDir>/decide.json`; there is no fallback to the first available classifier. Config fields are `model` (`provider/model-id`), `timeoutMs` (default 5000), `maxInputChars` (default 20000), and `cacheTtlMs` (default 600000, 0 disables).
  - Context: Explicit selection keeps cost, privacy, and behavior predictable.
  - Alternatives: first-available fallback; per-call model override; no config.
  - Consequences: missing or invalid config makes `decide` unavailable until fixed.

- [x] D90 [R25]: `decide` caps input at the configured limit, times out on the configured deadline, and returns explanatory error text for invalid input, missing config, unavailable auth, classifier error, abort, or timeout. It never mutates session state or throws for capability failures.
  - Context: Classification is advisory and must not block the workflow.
  - Alternatives: let provider errors throw; no input cap; no timeout.
  - Consequences: callers must handle an error-string result; very large text is rejected rather than truncated silently.

- [x] D91 [R26]: Successful decisions are cached in memory per session and concurrent identical calls share one in-flight request. The key includes model, kind, question, criteria, and input; TTL comes from config; aborted or failed calls are not cached.
  - Context: This removes duplicate latency and quota use without persisting private input.
  - Alternatives: no cache; disk cache; cache without in-flight dedupe.
  - Consequences: identical calls after TTL or on a new session hit the classifier again.

- [x] D92 [R27]: The package is a direct Pi tool only. It does not activate codemode, add a CLI, register a service, or depend on `pi-guard`. A direct tool is callable from codemode scripts as well.
  - Context: Start with the smallest useful surface and extract shared layers when a second consumer appears.
  - Alternatives: CLI now; guard service now; core service registry.
  - Consequences: OpenCode and other harnesses cannot use it until a CLI exists; `pi-guard` keeps its own judge.

- [x] D93 [R28]: The classifier payload contains only the caller-supplied `input`, `question`, and criteria. It never adds cwd, mode, session history, file contents, or tool output, and v1 adds no automatic redaction; callers must omit secrets.
  - Context: Classifier input may contain private text, so payload control must be explicit.
  - Alternatives: automatic context enrichment; regex redaction; local-only enforcement.
  - Consequences: privacy depends on the caller and tool description; a remote classifier sees exactly what the model sends.

- [x] D94 [R29]: Use one process-wide FIFO prompt queue exported by core and shared across extension module roots; every blocking dialog or confirmation site opts in, while nested acquisition is forbidden.
  - Context: Cross-extension collisions need one owner; process-wide is the smallest scope that covers main-session prompts without new dependencies.
  - Alternatives: per-session queue; extension-local queue; rely on the host UI; monkey-patch `ctx.ui`.
  - Consequences: a hung dialog blocks later prompts; consumers must call the helper explicitly; a reentrant prompt must bypass the lock or fail.

- [x] D107 [R36]: Todos use tool-free tagged blocks and render in a sticky widget above the prompt box sharing the area with subagent execution states (running, blocked, complete); no statusline/dashboard segment.
  - Context: A sticky section above the prompt box keeps active work visible without cluttering conversation history or requiring statusline integration.
  - Alternatives: inline chat output only, statusline/footer segment, dashboard panel.
  - Consequences: Shared widget area above prompt box coordinates todos and subagent states; tool-free tagged blocks preserved.

- [x] D108 [R37]: `/context` lives in the pi-guard slash-command family alongside `/mode` and `/cd`.
  - Context: Co-locating with other slash commands keeps the command surface unified.
  - Alternatives: separate pi-context/pi-utilities extension, core shared command.
  - Consequences: Reuses existing command registration and UI; no new extension package.

- [x] D112 [R40]: `pi-modal` implements a `CustomEditor` with Vim normal/insert/visual modes and loads key overrides exclusively from global `~/.pi/agent/modal.json`.
  - Context: Global user keybindings maintain consistent muscle memory across all repositories.
  - Alternatives: project-level `.pi/modal.json` overrides, hardcoded key bindings without user config.
  - Consequences: Custom editor component replaces default prompt input; users configure one shared Vim keymap globally without project churn.

- [x] D115 [R43]: Dedicated `pi-agent` extension owns `/agent` slash command, auto-forking, branch labeling, and skill filtering.
  - Context: Distinct agent roles require isolated system prompts, tailored skills, and branched session histories to maintain conversational and architectural integrity.
  - Alternatives: Keep `/agent` in `pi-subagents`, make `/agent` a simple persona switcher without session forking, filter skills by unloading extension modules.
  - Consequences: `pi-subagents` stays focused strictly on child process execution; switching agents automatically creates a branch in the session tree (`agent: <name>`) and renames the session `[<agent>] <title>`; skill filtering dynamically restricts `event.systemPromptOptions.skills` without altering extension registrations; modal overlay popup presents agent details.

- [x] D117 [R45]: Budget displays as `$0.012` (usage only) or `$0.012/$1.000` (cap active) in `pi-statusline`, while `pi-budgets` provides a detailed breakdown panel and discontinues `ctx.ui.setStatus("budget")`.
  - Context: A compact statusline element keeps cost constantly observable without distracting footer changes.
  - Alternatives: Keep verbose footer string, show budget only inside todo widget, token counts only in statusline.
  - Consequences: Statusline gains simple ratio/usage rendering; `pi-budgets` emits structured metrics for statusline and panel; verbose default footer is silenced.

- [x] D118 [R46]: `ModalEditor` tracks anchor and active cursor offsets to render visual selection highlighting and executes yank/cut/change using terminal clipboard utilities.
  - Context: Vim visual mode requires character-exact in-buffer selection tracking to work reliably in raw terminal mode.
  - Alternatives: rely on native terminal mouse selection, pass shift-arrow escape sequences to underlying editor.
  - Consequences: Editor maintains internal visual selection range; `render()` styles highlighted characters with selection background; `y`, `d`, `x`, `c` operate on selection range.

- [x] D119 [R47]: Prompt decoration adds a configurable `promptChar` (default `'❯'`) to `modal.json`, and all bordered components adopt Unicode rounded box-drawing characters (`╭`, `╮`, `╯`, `╰`).
  - Context: Unified rounded borders give cohesive visual identity across extensions while single-character prompt decoration prevents layout breakage.
  - Alternatives: keep sharp 90-degree corners, allow arbitrary string prefixes, hardcode prompt characters without user configuration.
  - Consequences: `pi-modal`, `pi-todos`, `pi-agent` popup, and any future bordered widgets share rounded box framing; `modal.json` adds `promptChar: string`.

- [x] D121 [R49]: `pi-todos` introduces `delete_todos` block requiring all items to be marked complete before execution, and adds `/todo delete [id]` and `/todo complete <id>` user commands.
  - Context: Requiring all items to be complete before agent deletion ensures tasks are not lost mid-flight while users retain immediate manual override.
  - Alternatives: allow agent to delete incomplete items, require user confirmation prompt on every deletion, allow only complete without delete.
  - Consequences: Parser enforces completion precondition for `delete_todos`; slash commands `/todo delete [id]` and `/todo complete <id>` give user full manual control.

- [x] D122 [R50]: `pi-todos` implements a `^x p` (`Ctrl+X` then `p`) prefixed keybinding handler and `/panel toggle` command to collapse/expand sticky panels, and unifies task and subagent widget layouts.
  - Context: Prefixed hotkeys avoid colliding with text input or standard editor keybindings while unified row formatting minimizes visual cognitive load.
  - Alternatives: single un-prefixed hotkey, slash command only, separate toggle keys per section.
  - Consequences: Prefix chord state machine intercepts `^x` then `p` in raw keyboard input; widget can collapse to zero lines; task and subagent rows share `@<id> <elapsed> (<task>) <status> · <action> <duration>` format.

- [x] D123 [R51]: `pi-todos` adds `/todo edit <id> <text>`, priority field, `/todo complete all`, and `/todos search <query>`.
  - Context: Full CRUD makes todos a real task tracker instead of a simple checklist.
  - Alternatives: separate edit command, priority as tag, complete-by-filter.
  - Consequences: Todo interface gains optional `priority`; edit reuses existing ID; bulk complete iterates all open; search filters widget and list view.

- [x] D125 [R53]: `pi-modal` adds vim-style search (`/`), substitution (`:%s`), syntax highlighting via language detection, and visual selection background.
  - Context: Search and highlighting are core vim features users expect from a modal editor.
  - Alternatives: external search tool, no highlighting, selection via terminal native.
  - Consequences: Search state lives in editor; substitution operates on buffer lines; highlighting uses pi-tui theme tokens; visual mode sets selection background.

- [x] D126 [R54]: `pi-usage` absorbs `pi-budgets`: per-model cost table, cache token tracking, subagent turn attribution, soft budget warnings.
  - Context: Merging eliminates duplicate accounting and gives one place for all cost concerns.
  - Alternatives: keep separate extensions, usage-only without budgets.
  - Consequences: Single extension owns all cost accounting; budgets config moves into usage config; soft warnings at 80% of cap.

- [x] D129 [R57]: `pi-dashboard` adds retry with backoff on section failure, key-triggered manual refresh, and pluggable render functions.
  - Context: Resilience and extensibility make dashboard suitable for real monitoring.
  - Alternatives: fail silently, auto-refresh only, built-in renderers only.
  - Consequences: Failed sections retry 3 times with exponential backoff; key binding triggers immediate refresh; render functions loaded from config TS path.

- [x] D131 [R59]: `pi-statusline` adds configurable click actions per segment and loads custom components from TS files.
  - Context: Configurable clicks and custom components make statusline an extensible control surface.
  - Alternatives: fixed click actions, built-in components only.
  - Consequences: Click config maps segment name to action command; custom components imported from configured path exporting ComponentFn.

- [x] D133 [R61]: `pi-hooks` adds hook chaining, conditional execution, output formatting, and per-hook timeout.
  - Context: Chaining and conditions enable complex multi-step hook workflows.
  - Alternatives: single hook per event, unconditional, fixed timeout.
  - Consequences: Hooks run in sequence with output piped; conditions filter by tool/path; output format configurable; timeout per hook in config.

- [x] D134 [R62]: `pi-question` supports multi-page questions with Next/Back and conditional branching.
  - Context: Multi-page and branching handle complex decision trees cleanly.
  - Alternatives: single page only, static question list.
  - Consequences: Page navigation state tracked; conditions evaluate prior answers; all state stays in context window.

- [x] D136 [R64]: Animated working indicator uses a spinner with elapsed timer, respecting reduced-motion and config toggle.
  - Context: Animation provides liveness feedback without overwhelming the terminal.
  - Alternatives: static text only, progress bar, no indicator.
  - Consequences: Spinner frames cycle at configurable interval; elapsed time shown in seconds; disabled via `animations: false` in config.

- [x] D137 [R65]: `pi-modal` border style configurable via `modal.json` `borderStyle` field, defaulting to rounded, right-side only.
  - Context: Configurable borders match user terminal aesthetic while keeping the clean left prompt edge.
  - Alternatives: always rounded, no borders, full box.
  - Consequences: Border style enum (rounded/double/dashed/sharp/none); only right edge bordered; left edge stays clean for prompt char.

- [x] D138 [R08] [R26]: `@hollowheap/core` owns a session-scoped TTL/LRU cache primitive. Caches are namespaced per session owner and invalidated by `dropSession`; `pi-decide` uses separate result and in-flight caches capped at 128 entries each.
  - Context: This is a session slice, not a cache-only slice: the core primitive ships with the classifier consumer that proves the contract.
  - Alternatives: keep the classifier-local `WeakMap`; add a generic cache without session ownership; use a process-wide cache.
  - Consequences: session isolation and eviction live in one host-free primitive; cache stores survive only while the session owner is alive; `pi-decide` still owns TTL and request semantics.

- [x] D139 [R19]: `lang` is codemode-only. The extension always registers `exposure: "codemode"` and activates codemode on `session_start`; there is no direct or hidden mode, and `language-tools.json` no longer accepts an exposure override.
  - Context: Navigation is orchestration surface, so keeping it out of the direct schema is the invariant.
  - Alternatives: direct default with opt-in codemode; hidden opt-out; per-call exposure.
  - Consequences: direct tool schemas never expose navigation; codemode must be available for `lang`; stale `exposure` fields are ignored.

- [x] D140 [R19]: `lang` adds the read-only actions `signature_help`, `type_definition`, `implementation`, `document_highlights`, and `diagnostics`; diagnostics use pull when advertised, otherwise push `publishDiagnostics`, and no formatting, rename, or code-action edits are added.
  - Context: These are low-cost language-server capabilities that make `language-tools` useful beyond navigation.
  - Alternatives: navigation only; separate lint package; formatter support.
  - Consequences: the tool stays read-only; diagnostics depend on server capabilities; call hierarchy, workspace diagnostics, and formatting remain out of scope.

- [x] D143 [R18]: Todo blocks and the `todos_format` prompt section work in every mode, including print/JSON. State is re-appended after compaction, malformed message/event payloads are ignored, and terminal chord listeners are disposed before re-registering and on shutdown.
  - Context: Branch-local state must not depend on UI availability or survival of compacted custom entries.
  - Alternatives: keep headless inert; rely on reload to restore dropped entries; accept stacked chord handlers.
  - Consequences: headless runs persist and confirm todo changes without widgets or dialogs; compaction preserves the branch-local state; one chord listener is active at a time.

- [x] D144 [R36] [R50]: `formatTodoWidget` takes `(todos, subagents, tasks, options)` only; open todos are always shown before completed rows, split sections use combined todo content and a `┼` junction, and the unused `statusText` export is removed.
  - Context: The widget must surface actionable open work first and keep one rendering contract.
  - Alternatives: keep the overloaded third argument; preserve priority-only sorting; keep dead status helper.
  - Consequences: callers pass one options object; completed rows cannot crowd open work out of the ten-row widget; the API surface is smaller.

- [x] D146 [R16]: `rg` runs with `--json` and parses match events internally; the public `parseRgLine`/`RgMatch` seam is removed. `isFileTarget` distinguishes missing paths from permission/stat failures instead of swallowing all errors.
  - Context: Structured output removes the path/text separator ambiguity without a public parser.
  - Alternatives: colon-delimited output with a greedy parser; export the parser for tests.
  - Consequences: paths and match text containing colon-digit sequences parse correctly; stat failures surface as tool errors; tests feed JSON match records.

- [x] D147 [R16]: `createFdTool(exposure?)` and `createRgTool(exposure?)` no longer accept an `ExecDeps` object. Tool modules call `runBinary`/`statMtimeMs` directly; tests mock `./exec.js` and use real binaries for integration cases.
  - Context: The injection layer was larger than the tool coordination and had no requirement.
  - Alternatives: keep the dependency object as a test seam; inject only the runner.
  - Consequences: production signatures carry only exposure; fake-output tests swap module mocks; `runBinary` behavior remains covered by core tests.

- [x] D148 [R16] [R21]: Remove the direct `fd` and `rg` tools. `pi-tools` becomes the `/cd` workspace command only; search and discovery use `bash` with `rg`, `fd`, and `ls`. Built-in `grep`/`find` remain excluded in the active setup.
  - Context: Bash is already the intended search path; keeping duplicate direct search schemas did not justify their cost.
  - Alternatives: keep `fd`/`rg`; reactivate built-in `grep`/`find`; move `/cd` into `pi-guard`.
  - Consequences: saves 1,045 tool-definition bytes (~261 tokens); `pi-tools.json` and tool exposure config are removed; per-result deny filtering is no longer provided by a direct search tool; built-in `bash` shell policy remains the search gate.
  - Resolves: Q01, Q02, Q03, Q06

- [x] D150 [R10] [R14] [R45] [R54]: Retire `pi-budgets`. `pi-usage` owns optional dollar caps, 80% warnings, 100% abort, and the statusline `usage` provider; `pi-autopilot` entering no longer requires a cap.
  - Context: Optional caps preserve autopilot safety without making the mode unusable for normal work.
  - Alternatives: keep the budget gate; keep two cap systems; require a cap for autopilot.
  - Consequences: `pi-budgets`, its `/budget` command, token caps, and autopilot gate are removed; `/usage cap` is the single cap surface; statusline defaults move from `budgets` to `usage`; pi-autopilot depends only on core and pi-guard.

- [x] D153 [R21]: Remove `powershell` and `ls` from the default active tool set; use `bash` for listing and shell work.
  - Context: Q04 accepted removal of both host tools; `bash` is the portable listing path on Linux and already owns shell work.
  - Alternatives: keep both; keep `ls` only; keep `powershell` only.
  - Consequences: the default active set drops the 594-byte `powershell` schema and the 447-byte `ls` schema; `bash` remains the listing path; users can still enable either tool explicitly.
  - Resolves: Q04

- [x] D155 [R72]: Keep local `pi-web` as the engine and port selected upstream functions: DNS/CIDR SSRF validation on every redirect, bounded response reads, and empty-result provider fallback; do not adopt upstream providers or extraction adapters in this slice.
  - Context: Q12 chose the local engine plus upstream features; local tools already own the normalized contract and caching/rate-limit surface, while upstream has stronger SSRF and bounded I/O.
  - Alternatives: adopt `pi-web-access` and retire local; wrap upstream behind an adapter; keep local unchanged.
  - Consequences: local `url.ts`/`fetch.ts`/`selection.ts` gain DNS resolution, CIDR checks, redirect revalidation, body caps, and empty-result fallback; provider set and tool shapes remain local; no new dependency.
  - Resolves: Q12

- [x] D156 [R18]: Keep tool-free todo text blocks; do not adopt `rpiv-todo`'s `todo` tool. Port selected dependency and overflow behaviors without adding a model tool.
  - Context: Q14 kept the local todo shell; upstream has replay defects and a mismatched host peer scope, while the local text-block model already owns state and rendering.
  - Alternatives: adopt `rpiv-todo`; hybrid text blocks plus tool; defer.
  - Consequences: `pi-todos` registers no model tool; text-block commands remain canonical; dependency/cycle and open-first overflow behavior are specified separately; no upstream dependency.
  - Resolves: Q14

- [x] D162 [R69] [R70]: External alerts use a host-free core notification helper with per-extension adapters; no model tool.
  - Context: The user chose a shared core seam plus adapters so event owners do not duplicate delivery, deduplication, or privacy rules.
  - Alternatives: new `pi-notify` extension; extend `pi-statusline`/`pi-todos`; per-extension duplicate delivery.
  - Consequences: core exposes alert event and payload types plus deduplication and fallback; adapters deliver Linux native or terminal alerts; payloads remain IDs and status only.

- [x] D168 [R77]: Extract PDF text locally with `pdftotext`, bounded output, and no browser or upstream engine.
  - Context: Direct PDF URLs currently return empty content; a local system parser is available and avoids a new runtime package.
  - Alternatives: PDF.js dependency; provider extraction; metadata-only.
  - Consequences: raw PDF fetches write a temporary file, run `pdftotext`, cap output, and fail with explanatory text when unavailable.
  - Supersedes: none

- [x] D169 [R78]: Return bounded direct-image bytes as one model image block; keep media metadata and terminal previews.
  - Context: Direct image URLs currently return empty content; Pi tool results support image blocks.
  - Alternatives: metadata-only; upstream renderer; terminal-only preview.
  - Consequences: allowed image MIME types under the byte cap become an image block; oversized or unsupported images fall back to text.
  - Supersedes: none

### Framework & Library Choices

- [x] D61 [R19]: A new `extensions/pi-language-tools` extension owns code intelligence and registers one `lang` tool with `exposure: "codemode"`; `pi-tools` stays stateless and core gains no host or process code
  - Context: LSP servers need lifecycle, config, and cleanup, which do not belong in the stateless fd/rg package or the host-free core.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D62 [R19]: `lang` is a dependency-free LSP client over stdio using Node builtins; it lazily starts one server per server command/args plus workspace root, reuses it across queries, applies request timeouts, and kills every server on session shutdown
  - Context: no other runtime dependency is permitted, and per-query spawning would dominate latency for position-based queries.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D63 [R19]: Server definitions come from built-in language mappings overlaid by `<agentDir>/language-tools.json`; servers spawn only when `ctx.isProjectTrusted()` is true, never auto-install, and return a setup hint when the command or config is missing
  - Context: language servers execute project code, so project trust is the boundary; auto-install would widen the supply-chain surface.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D64 [R19]: `lang` is read-only and supports `definition`, `references`, `document_symbols`, and `workspace_symbols`; input positions are 1-based, results are capped and path-checked with core read/search rules, and unsupported files or missing servers return explanatory text instead of throwing
  - Context: the model should query by editor-style coordinates, and returned locations must respect pi-guard policy.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D130 [R58]: `pi-language-tools` adds `hover` tool returning type/signature/docs, with optional TUI popup.
  - Context: Dual-purpose hover serves both model reasoning and user inspection.
  - Alternatives: TUI-only hover, tool-only hover.
  - Consequences: Tool returns structured hover data to model; TUI popup shows same data when UI available; popup is dismissible.

### Data & Contracts

- [x] D06 [R09]: Rule effects widen to `allow | ask | deny`
  - Context: prompting on specific paths/tags must be declarative rather than procedural.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D07 [R09]: Modes are declarative layers (`defaults` per tag + restrictive `overrides`), replacing `apply()` callbacks and `inPlanPaths`
  - Context: policy posture becomes data, testable without consumer code.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D08 [R09]: Fixed precedence: hard safety → project deny → mode overrides → project allow/ask by specificity (ties stricter) → mode defaults; array order never decides
  - Context: deterministic, order-independent outcomes.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D09 [R09]: Mode matrix: `ask` (allow/ask/ask), `edit` (allow/allow/ask), `plan` (allow/deny/ask with plan-artifact edit overrides), `autopilot` (allow/allow/allow); `ask` is the session default
  - Context: matches the correction table and existing user expectations.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D10 [R09]: Modes register in core, first-wins by name, entry gates run in registration order and the first veto blocks
  - Context: deterministic registry without event-channel coupling.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D11 [R09]: Plan paths stay `artifacts/plan.md` and `artifacts/specs.md`; writes there ask in plan mode
  - Context: accepting a plan is the approval dialog itself.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D23 [R13]: `@hollowheap/core` moves to 0.2.0; consumers depend on `^0.2.0`
  - Context: the runtime foundation is a breaking API change (Effect widens, `ModeDefinition.apply` removed).
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D24 [R13]: The active mode persists across `session resume`/`fork` as a session custom entry (`appendCustomEntry("hollowheap.core.mode", { mode })`, restored from `getEntries()`)
  - Context: user choice; the session file is the durable boundary and fork copies entries.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D25 [R13]: Config-defined mode layers live in `<agentDir>/modes.json` (default `~/.pi/agent/modes.json`), following the `statusline.json`/`dashboard.json` convention
  - Context: package configs already live in the agent config folder, not the project.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D26 [R13]: `modes.json` supports `{"modes": {"<name>": {"defaults": {...}, "overrides": [...]}}}`; overrides must be `ask`/`deny`; config layers cannot shadow built-in or package modes; invalid entries are dropped with once-per-change diagnostics; config layers are replaced on reload while built-ins/package layers persist
  - Context: one predictable schema; config cannot redefine `ask` into an allow-all.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D27 [R13]: Entry gates also run when a mode is restored from the session; a veto falls back to `ask` with a notice
  - Context: a persisted `autopilot` must not resume without its budget cap.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D73 [R21]: `fd` and `rg` default to `direct`; each reads `direct|codemode|hidden` from `pi-tools.json`. `lang` is always codemode per D139 and ignores any `exposure` field in `language-tools.json`.
  - Context: search tools stay direct for single calls, while `lang` stays out of the direct schema and remains available for orchestration.
  - Supersedes: the codemode-default parts of D42, D43, D61, and D66.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D74 [R21]: `permissions.json` accepts a `tools` map of tool name to `edit|read|search|shell`; built-in mappings win, invalid tags are diagnosed, and unknown tools still ask
  - Context: MCP tools need classification without letting config remap destructive built-ins.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D75 [R21]: The todo widget shows up to 10 open todos; `/todos` and the status count remain unchanged
  - Context: five hid too much of a normal list, while ten fits without taking over the transcript.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D110 [R39]: pi-budget reads pricing from the configured provider and enforces caps in dollars.
  - Context: Provider pricing keeps budgets aligned with actual billed cost.
  - Alternatives: static price table, token-only caps.
  - Consequences: Budget logic depends on provider pricing availability; fallback to tokens when missing.

- [x] D111 [R39]: A `pi-usage` extension persists cost and token usage across compaction.
  - Context: Persistence prevents loss of cumulative cost on compaction.
  - Alternatives: store usage only in pi-budget, recompute after compaction.
  - Consequences: New extension package; shared state with pi-budget.

- [x] D114 [R42]: `pi-web` exposes `web_search` and `web_fetch` exclusively with `exposure: "codemode"`, and core pricing treats `:free` models as $0.00.
  - Context: Pure codemode execution eliminates LLM prompt overhead and enables multi-step research loops in a single turn.
  - Alternatives: dual direct/codemode exposure, declaring tools in LLM prompt by default.
  - Consequences: Tools are callable only within QuickJS scripts; prompt tokens are saved; free models evaluate to $0.00 without NaN.

- [x] D128 [R56]: `pi-web` adds TTL-based response cache, request queue for rate limiting, and `Accept` header negotiation.
  - Context: Caching and throttling reduce redundant fetches and avoid provider blocks.
  - Alternatives: no cache, external cache layer, fixed content type.
  - Consequences: Cache keyed by URL+headers with configurable TTL; queue limits concurrent requests; Accept header set from tool intent (JSON/HTML/text).

- [x] D132 [R60]: `pi-agent` validates agent configs with schema and reports errors on load.
  - Context: Early validation prevents silent misconfiguration.
  - Alternatives: runtime validation only, silent skip.
  - Consequences: Invalid agents skipped with diagnostic; valid agents loaded normally; validation errors shown in notification.

- [x] D145 [R10] [R16]: `pi-tools` validates search targets against the project root and permission rules before running `fd`/`rg` or calling `stat`, filters result paths before stat, and makes `/cd` completion use the active working directory, root containment, and read policy. Config read errors other than `ENOENT` produce diagnostics.
  - Context: Search containment must be enforced before side effects, not only after output.
  - Alternatives: rely on post-binary filtering; keep completions relative to `process.cwd`; silently fall back on unreadable config.
  - Consequences: denied or outside-root paths do not leak existence or mtime; symlink escapes are denied before execution; completions omit denied directories.

- [x] D149 [R39] [R54]: `pi-usage` validates persisted usage, totals cache tokens, prices each assistant turn with the message model, stores session state in a WeakMap, restores `budgetWarning`, and exposes `/usage cap` for a dollar cap with 80% warning and 100% abort.
  - Context: Usage must stay accurate across model switches, compaction, and module reloads.
  - Alternatives: keep cost tied to the current model; round totals independently; leave the cap without a setter.
  - Consequences: invalid by-model entries are dropped; cache tokens count toward totals; cap changes persist as usage entries; `pi-budgets` is retired by D150.

- [x] D151 [R39] [R54]: The `pi-usage`/`pi-budgets` merge uses USD caps only. Token caps are intentionally dropped; `/usage cap` sets a dollar amount. `pi-usage` is the single budget owner and statusline provider.
  - Context: USD is the billing unit users reason about; duplicate token and dollar caps caused conflicting limits.
  - Alternatives: carry token caps into usage; keep dual token/dollar accounting; preserve `pi-budgets` for token limits.
  - Consequences: users set a dollar cap with `/usage cap`; no token-limit command or statusline token ratio remains; autopilot has no mandatory cap.

### Operations & Security

- [x] D28 [R14]: Permission rules move to `<agentDir>/permissions.json` (default `~/.pi/agent/permissions.json`), following the `modes.json`/`statusline.json` config-dir convention
  - Context: config belongs in the agent config folder, not each project.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D29 [R14]: A project `.pi/permissions.json` is an overlay loaded only when `ctx.isProjectTrusted()` is true; untrusted projects are ignored with a once-per-change notice, while agent-dir rules still apply
  - Context: a cloned repo must not grant itself permissions.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D30 [R14]: `pi-budgets` computes usage as a `getBranch()` baseline at session start plus `message_end` deltas
  - Context: current maps reset on resume/fork and undercount against the cap.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D31 [R14] [R22]: All nine workspace packages move to `0.2.0` together, and consumer dependencies use `^0.2.0`
  - Context: one coordinated release; consumer behavior changes with the core refactor.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D32 [R14]: `session/request_permission` has no wall-clock timeout; it is rejected only by client reply, disconnect, child exit, or session close
  - Context: user choice; no silent denial while the client is still deciding.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D33 [R14]: Plan-path detection resolves against the effective cwd (`/cd` override), not the original workspace root
  - Context: `/cd` exists to recover from starting the session in the wrong directory, so policy should follow it.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D34 [R14]: The ACP adapter learns the mode list from the extension over the socket and offers every registered mode to the client; a mode notice rides in the returned config option's description
  - Context: the extension owns the registry, so a hardcoded `plan`/`ask`/`edit` list hid extension modes such as `autopilot` and left mode notices with nowhere to go.
  - Alternatives: not recorded.
  - Consequences: see the linked spec and tests.

- [x] D109 [R38]: Trusted roots are configured per user; untrusted roots fall back to `ask`, with allow/ask/deny decisions persistable for the session or indefinitely.
  - Context: User-controlled trust keeps out-of-workspace access explicit and reversible.
  - Alternatives: hard deny only, automatic trust of parent directories.
  - Consequences: Requires root-trust storage and a persistence scope on verdicts.

- [x] D120 [R48]: Sandboxing uses `bwrap` (Bubblewrap) to isolate shell execution with read-only root and workspace-only writable bind mounts.
  - Context: Bubblewrap provides instant sub-10ms startup, unprivileged namespace isolation, and zero background daemon maintenance.
  - Alternatives: Podman rootless container exec, Docker container wrapper, Landlock/seccomp native Node bindings.
  - Consequences: Uses host `bwrap` binary without daemon requirements; maps workspace directory read-write; isolates `~/.ssh`, `~/.gnupg`, and host dotfiles.

- [x] D135 [R63]: `pi-guard` adds `/grant` for temporary permission grants with expiry.
  - Context: Temporary grants unblock one-off operations without weakening permanent policy.
  - Alternatives: permanent rule changes only, manual config edit.
  - Consequences: Grants stored in session state; expiry checked on each permission evaluation; `/grants` lists active grants.

- [x] D154 [R48]: Sandbox extension-run commands and background tasks with `bwrap`; built-in `bash` and the whole Pi process require an outer container boundary.
  - Context: Q10 accepted an honest boundary; the extension can wrap its own spawned commands but cannot intercept built-in `bash` or sandbox the host process.
  - Alternatives: spawn-only without documentation; whole-process only; both enforcement layers.
  - Consequences: `bwrap` wraps extension-run and background commands; docs state that built-in `bash` and the whole process are out of scope; missing `bwrap` fails closed for covered paths.
  - Resolves: Q10

- [x] D157 [R69]: External alerts fire for completion, error, question, task completion, and subagent completion; permission/ask events remain in-terminal.
  - Context: Q07 selected the useful alert set from the brainstorm; approvals already need immediate terminal attention and would add noise.
  - Alternatives: also permission/ask; completion and error only; all listed events.
  - Consequences: alert config exposes five event categories; permission asks stay in-terminal; task and subagent completion share deduplication.
  - Resolves: Q07

- [x] D158 [R69]: Ship Linux native alerts with terminal bell/OSC fallback first; defer macOS and Windows native adapters.
  - Context: Q08 chose the current platform slice; Linux is the active environment, and terminal fallback keeps other platforms usable without native adapters.
  - Alternatives: Linux plus macOS native; all three native adapters; terminal-only.
  - Consequences: Linux uses the native notifier; missing notifier falls back to terminal bell/OSC; macOS/Windows native delivery is documented as deferred.
  - Resolves: Q08

- [x] D159 [R70]: Alert payloads contain only event and status identifiers; never prompt, task, or tool content.
  - Context: Q09 and R70 require privacy; alerts can leave the terminal and may be visible on a lock screen or shared desktop.
  - Alternatives: include task/subagent text behind an explicit opt-in; include all event text.
  - Consequences: payloads carry event type, IDs, and status only; users get less context but no prompt leakage.
  - Resolves: Q09

- [x] D165 [R74]: Task and subagent event owners emit one completion alert through the core delivery helper; alert failures never fail the task.
  - Context: The core helper is tested; event owners already observe terminal transitions and can emit without a new package.
  - Alternatives: new `pi-notify` package; polling; no completion alerts.
  - Consequences: task and subagent completion call the core dispatcher; duplicate completion alerts are suppressed; payloads stay IDs and status only.

- [x] D166 [R75]: Question and statusline event owners call the core alert helper for question and agent-completion events; delivery is injectable and test-disabled.
  - Context: The remaining alert events live in existing event owners; a small owner call avoids a new package and keeps tests side-effect free.
  - Alternatives: new `pi-notify` package; central event bus; no question/agent alerts.
  - Consequences: `pi-question` alerts when a valid question block is handled; `pi-statusline` alerts on agent completion; payloads contain only event/status identifiers.
  - Supersedes: none

- [x] D167 [R76]: Import upstream async subagent snapshots through a pure mapper into the local state-event shape; no dependency, bridge, or fork.
  - Context: Upstream exposes asyncSnapshot runs and child-status events, but task text is redacted and foreground runs are absent.
  - Alternatives: optional upstream bridge; separate compatibility package; no adapter.
  - Consequences: a pure mapper handles IDs, labels, states, start times, and active tools; terminal runs are omitted; local runner remains authoritative.
  - Supersedes: none

- [x] D170 [R10]: Permission categories are open tags, not a closed union; path matching applies only to `read`, `edit`, and `search`.
  - Context: Web and model actions are neither file reads nor shell commands, and forcing new categories through core edits blocks extension-defined policy.
  - Alternatives: keep a closed tag union; add separate `network` and `model` tags; leave non-path tools untagged.
  - Consequences: `shell` keeps command parsing; `external` is the built-in non-path category for URLs, queries, and `decide`; extensions can define additional tags; missing mode defaults for custom tags fall back to `ask`, while missing `external` defaults to `allow` for backward compatibility.
  - Supersedes: none

- [x] D171 [R10]: Headless permission enforcement and shared tool-target helpers live in `@hollowheap/policy`; `pi-guard` owns interactive approval and `pi-subagents` loads the headless extension for children.
  - Context: Subagents needed guard enforcement but importing the interactive extension created the last extension-to-extension dependency.
  - Alternatives: keep `pi-subagents -> pi-guard`; make guard optional; duplicate target mapping in subagents.
  - Consequences: the extension graph is flat; `pi-guard` and child processes share one tool-category/target implementation; interactive decisions stay in `pi-guard`.
  - Supersedes: none
