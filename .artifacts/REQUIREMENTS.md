# Requirements

### Core runtime, policy, and consumers

- [ ] R98: Mode naming uses `manual` for the human-authored mode and no longer accepts the legacy `ask` or `autopilot` aliases.
  - Verify: `npx vitest run extensions/pi-modes/src extensions/pi-guard/src`
  - Acceptance: documentation and user-facing mode lists use `manual`; legacy aliases are rejected with a diagnostic that names `manual`; the rule effect named `ask` is unchanged.
  - Constraints: rule syntax and verdict effects stay stable.
  - Non-goals: renaming the `ask` rule effect.
  - Rationale: the mode was already renamed in code while aliases and docs still advertise the old name.

- [x] R08: Shared policy, config, state, and subprocess primitives live in `@hollowheap/core` and every consumer uses them.
  - Verify: Core tests and consumer integration tests pass; no vendored policy copies remain.
  - Acceptance: One implementation serves TUI and ACP; shared state survives module duplication; core stays host-free.
  - Rationale: Duplicated policy caused drift and inconsistent permissions.

- [x] R09: Rules, modes, and precedence produce deterministic verdicts from data.
  - Verify: Core policy and mode tests pass, including specificity and restore cases.
  - Acceptance: Effects are `allow|ask|deny`; mode layers are declarative; array order never decides.
  - Rationale: Deterministic, order-independent policy is easier to test and audit.

- [x] R10: Consumer packages delegate policy to core and keep only their UI or transport responsibilities.
  - Verify: Consumer suites pass and no package reimplements rule parsing or shell analysis.
  - Acceptance: `pi-guard` owns prompting, `pi-usage` owns optional caps, tools owns `/cd`, ACP owns transport.
  - Rationale: One owner per concern keeps behavior aligned across harnesses.

- [x] R11: The ACP adapter routes execution through client capabilities and keeps built-ins from bypassing them.
  - Verify: ACP adapter and extension tests pass, including spawn args and lifecycle cases.
  - Acceptance: One pi child per session, socket transport, permission correlation, bounded terminal polling.
  - Rationale: ACP clients must remain the only execution path.

- [x] R12: Statusline and dashboard extend the UI without breaking narrow terminals or shutdown.
  - Verify: UI package tests pass, including width and abort cases.
  - Acceptance: Extension segments render consistently; in-flight commands stop on shutdown.
  - Rationale: UI regressions are user-visible and hard to catch in logic tests.

- [x] R13: Modes persist across resume/fork and can be extended by user config without shadowing built-ins.
  - Verify: Core, guard, and ACP mode tests pass.
  - Acceptance: Mode state survives branches; `modes.json` validates and replaces config layers on reload.
  - Rationale: A resumed autopilot session must not bypass its gates.

- [x] R14: Permissions, budgets, release versioning, and ACP permission timing have one documented contract.
  - Verify: Core, guard, usage, and ACP tests pass.
  - Acceptance: Agent rules plus trusted overlay; usage baseline plus deltas; `^0.2.0` consumers; client-decided permissions.
  - Rationale: Cross-package releases and permissions need one reference.

### Hooks, tools, question, todos, language tools, tasks, and exposure

- [x] R15: `pi-hooks` runs configured commands at session start and around tool calls.
  - Verify: `extensions/pi-hooks/src` tests pass.
  - Acceptance: Pre-hooks fail closed; post-hooks append output; session hooks warn only; trusted overlay only.
  - Rationale: Hooks let the model install checks without writing an extension.

- [x] R16: `fd`/`rg` were callable from scripts without changing the declared tool set; removed by D148 on 2026-10-30.
  - Verify: `pi-tools` tests pass with no model tools registered.
  - Acceptance: `pi-tools` registers `/cd` only; `bash` is the search path; `tool_search` stays disabled.
  - Rationale: The direct search schema duplicated built-in capability and was removed.

- [x] R17: Questions are answered through sequential UI dialogs driven by the codemode-only `question` tool (superseded tool-free tagged blocks in `117285e`).
  - Verify: `npx vitest run extensions/pi-question/src`
  - Acceptance: Valid questions run sequentially, dialogs cancel safely with partial-answer reporting, print/json stay inert.
  - Rationale: Sequential UI dialogs capture structured user decisions; codemode keeps schema overhead off the direct tool surface.

- [x] R18: Todos maintain branch-local state via the codemode-only `todo` tool (superseded tool-free tagged blocks in `117285e`).
  - Verify: `npx vitest run extensions/pi-todos/src`
  - Acceptance: Create appends with stable IDs, complete marks done, state restores, `/todos` and status show progress.
  - Rationale: Branch-local state keeps resume and fork coherent.

- [x] R19: Code intelligence is read-only LSP navigation with trust and path checks.
  - Verify: `pi-language-tools` tests pass.
  - Acceptance: Navigation, hover, signature help, type/implementation, highlights, and diagnostics use 1-based positions, pooled servers, bounded output, and explanatory failures.
  - Rationale: The model should navigate and inspect code by editor coordinates without gaining write access.

- [x] R20: Durable background shell tasks survive pi exit and stay under shell policy.
  - Verify: `pi-tasks` tests pass.
  - Acceptance: Start/list/status/wait/cancel; detached runner; PID/start-time reconciliation; trust gate; ACP inert.
  - Rationale: Long-running work must not require a live foreground shell.

- [x] R21: Tool exposure, guard tags, and todo widget density are user-visible defaults.
  - Verify: `pi-tools`, `pi-language-tools`, `pi-guard`, and `pi-todos` tests pass.
  - Acceptance: `pi-tools` registers `/cd` only; `lang` codemode-only; MCP tag map; ten-row todo widget.
  - Rationale: Single-call tools belong in the direct schema; codemode is for orchestration and `lang` navigation.


- [x] R22: The suite is split into core plus focused packages, with the final split verified green.
  - Verify: Final suite, typecheck, and lint pass after the split.
  - Acceptance: Core owns runtime foundations; guard, tools, usage, autopilot, statusline, dashboard, and question are separate packages.
  - Rationale: The split replaced the monolithic mode-guard package without changing behavior.

- [ ] R100: Question navigation keeps prior answers, a first Escape returns from a free-text answer to the choice list, and the flow ends with an inline review.
  - Verify: `npx vitest run extensions/pi-question/src`
  - Acceptance: left and right move to the previous or next question without wrapping and preserve every committed answer; from an open answer the first Escape returns to the multiple-choice dialog and a second Escape cancels the flow; after the last question an inline review lists all answers and supports jumping back to edit, confirming, and cancelling without data loss.
  - Constraints: only one dialog is open at a time (R29).
  - Non-goals: mouse navigation or a separate validation window.
  - Rationale: accidental Escape loses work, and users need to revisit earlier answers before submitting.

- [ ] R94: A question dialog uses the prompt area itself and never leaves a second prompt visible underneath.
  - Verify: `npx vitest run extensions/pi-question/src extensions/pi-modal/src`
  - Acceptance: a dialog appears inside the prompt rows; multi-line typed text, cursor position, and draft are restored byte-for-byte when the dialog closes or cancels; focus returns to the prompt; no separate popup is drawn; only one dialog is open at a time.
  - Constraints: prompt ownership is shared with the modal editor extension.
  - Non-goals: upstream host changes or a new terminal rendering engine.
  - Rationale: a floating dialog over a populated prompt hides the text the user was writing.

### Web tools

- [x] R01: A standalone web-tools extension exposes `web_search` and `web_fetch` as direct tools and is included in the git suite.
  - Verify: Installing the suite or the package alone registers exactly these two tools; the full test suite and typecheck pass.
  - Acceptance: No other package owns the tools; both are direct, not codemode.
  - Rationale: Coding agents need current docs and web results without adding a browser stack.

- [x] R02: `web_search` returns one normalized result shape regardless of provider.
  - Verify: Tests cover each provider adapter and fallback with the same output fields.
  - Acceptance: Each result has `title`, `url`, `snippet`, and `provider`; failures fall through; results are capped and truncation is reported.
  - Rationale: Provider APIs disagree on field names and nesting, so the model should not branch per provider.

- [x] R03: `web_fetch` returns readable page content for a URL with a normalized result shape.
  - Verify: Tests cover provider extract, raw fallback, caps, and media metadata.
  - Acceptance: Each fetch has `url`, `finalUrl`, `provider`, `contentType`, `content`, `links`, `media`, and `truncated`; no headless-browser mode; media is metadata only; links cap at 50 and media at 20.
  - Rationale: Search snippets are insufficient for API docs and long pages.

- [x] R04: Provider keys and selection are user configurable without editing code.
  - Verify: Tests cover env keys, `web.json` order arrays, missing keys, and invalid entries.
  - Acceptance: Keys come only from environment variables; `web.json` contains only search/fetch order arrays; unkeyed providers are skipped; configured order wins; errors never include keys.
  - Rationale: Free tiers change and keys differ per machine.

- [x] R05: `web_fetch` refuses internal targets.
  - Verify: Tests cover private, loopback, link-local, metadata, non-http(s), and redirect targets.
  - Acceptance: Only `http`/`https`; private targets rejected on every hop; redirects capped; rejection returns explanatory text.
  - Rationale: A URL tool that can reach internal networks is an SSRF primitive.

- [x] R06: Web tools obey `pi-guard` policy.
  - Verify: Guard tests cover both tool names and built-in tag precedence.
  - Acceptance: `web_search` tags as `search`, `web_fetch` as `read`, without user config; built-ins stay authoritative.
  - Rationale: Network reads cross a trust boundary just like local reads.

- [x] R07: Configuration and provider behavior are documented.
  - Verify: Package and root README checks pass; docs list providers, env keys, order arrays, shapes, caps, media, and no rendering.
  - Acceptance: Users can audit what leaves the machine and how fallback works.
  - Rationale: Provider terms and limits change, so the contract must stay visible.

### Classifier and prompt queue

- [x] R23: A direct `decide` tool returns one structured classifier answer for one caller-supplied question.
  - Verify: Tests cover `choice`, `score`, and `bool`, plus invalid kind and label input.
  - Acceptance: `choice` returns label, probabilities, and confidence; `score` returns index, label, and confidence; `bool` returns probability; result names model and usage.
  - Rationale: Skills need a cheap structured second opinion without free-form parsing.

- [x] R24: `decide` uses only the classifier explicitly configured for it.
  - Verify: Missing, malformed, or unavailable model config returns an explanatory error and makes no fallback call.
  - Acceptance: `<agentDir>/decide.json` requires `model: "provider/id"`; optional timeout, input cap, and cache TTL; no first-available fallback.
  - Rationale: Predictable model choice matters for privacy, cost, and reproducibility.

- [x] R25: `decide` bounds input and latency and fails without mutating state or crashing the session.
  - Verify: Tests cover oversized input, timeout, provider error, and aborted signal.
  - Acceptance: 20k-character input cap and 5s timeout by default; errors return explanatory text; no file, tool, or session mutation.
  - Rationale: Classification is advisory and must not block the workflow when unavailable.

- [x] R26: Repeated identical `decide` calls reuse one session result, and concurrent identical calls share one request.
  - Verify: Tests assert provider call counts for repeated, concurrent, changed, and expired inputs.
  - Acceptance: In-memory per-session cache keyed by model, kind, question, criteria, and input; 10-minute TTL; aborted calls are not cached.
  - Rationale: Caching avoids duplicate latency and quota use.

- [x] R27: `decide` is a direct Pi tool documented as advisory; v1 adds no CLI or guard service.
  - Verify: Index test asserts direct exposure; README documents advisory use and privacy; no CLI or service registration exists.
  - Acceptance: Direct tool, no codemode activation, no `pi-guard` dependency, no new core registry.
  - Rationale: The Pi tool is the smallest useful surface; extract shared layers only when a second consumer appears.

- [x] R28: `decide` sends only caller-supplied input, question, labels, and model id to the classifier.
  - Verify: Payload tests assert the exact classifier state and question fields; no filesystem or session reads occur.
  - Acceptance: No automatic cwd, session history, tool output, or file contents are included.
  - Rationale: Classifier inputs may contain private text, so the caller must control the payload.

- [ ] R93: Every tool call passes a bounded classifier check layered on existing policy, and an unavailable classifier never silently allows a call.
  - Verify: `npx vitest run extensions/pi-decide/src extensions/pi-guard/src packages/acp`
  - Acceptance: all tool calls in all modes receive a classifier verdict after existing rule verdicts; a classifier block stops the call with a reason; a needs-approval verdict uses the existing approval transport for the current harness; timeout, error, or missing configuration means the call still needs approval and records an audit note; the payload contains only tool name, tag, and a bounded input summary; identical calls share one per-session result; a per-session call cap is enforced; classifier work is counted in usage totals.
  - Constraints: no new dialog surface; the classifier is called directly rather than through a nested tool call; existing hard-deny rules and destructive-shell gates are never weakened.
  - Non-goals: new classifier providers, a guard service, or automatic redaction of tool input.
  - Rationale: auto mode currently trusts a broad allow set; a classifier gives it a second opinion without giving up fail-closed behavior.

- [x] R29: Interactive prompts across extensions are serialized so only one dialog or confirmation is open at a time.
  - Verify: Tests cover two concurrent prompt requests, FIFO order, release on resolve and rejection, and adoption by every current prompt site.
  - Acceptance: One process-wide queue; a second prompt waits; a failed or cancelled prompt releases the next; no new runtime dependency.
  - Rationale: Concurrent dialogs can overlap and steal input; one fair queue keeps prompts predictable.

### Subagents and durable process

- [ ] R97: Cancelling a child tears down every nested process group it created, and a cancelled state is reported only after those descendants are gone.
  - Verify: `npm test`
  - Acceptance: a task or subagent that spawns a nested child has that child's group recorded with its metadata; cancel and reconciliation terminate both groups with escalation; a user cancel reports `cancelled` only when no descendant remains; the same teardown primitive serves both owners.
  - Constraints: detached survivors of a normal parent exit keep their existing behavior.
  - Non-goals: killing processes a child intentionally reparents outside its groups.
  - Rationale: the shim and its inner command form two process groups; killing only the shim leaves the command alive.

- [x] R30: A direct `subagent` tool can start one child agent and later reattach, steer, wait, cancel, or resume it.
  - Verify: Tests cover start/status/send/wait/cancel/resume across parent restart and socket reconnect.
  - Acceptance: Child survives parent exit; `send` steers a running child; `resume` starts from the persisted session; one logical id never has two live children.
  - Rationale: Delegation must survive a parent restart without a central daemon.

- [x] R31: Subagent concurrency and recursion are bounded by configuration, and write/edit/bash calls serialize across child processes.
  - Verify: Tests cover configured caps, depth-limited recursion, lock contention, stale-lock recovery, and read-only overlap.
  - Acceptance: `maxConcurrent` and `maxDepth` (1–3) come from agent config; one writer at a time; read-only calls proceed in parallel; locks release on success, error, abort, or timeout.
  - Rationale: Parallel subagents are useful only if writes cannot interleave.

- [x] R32: Agent definitions load from user scope and trusted project scope, with model, thinking, and tool overrides.
  - Verify: Tests cover user agents, trusted project agents, untrusted rejection, invalid frontmatter, and project-over-user precedence.
  - Acceptance: User agents are always available; project agents require trust; missing model inherits the parent; `tools` can restrict a child; project agents override user agents by name.
  - Rationale: Project agents are repo-controlled prompts, so trust is the boundary.

- [x] R33: Durable subagent processes and state are reconciled, permissioned, and cleaned up without a daemon.
  - Verify: Tests cover detached survival, PID/start-time reconciliation, socket/state permissions, corrupted state, cancel, resume, and orphan cleanup.
  - Acceptance: State and sockets live under the agent directory with restrictive permissions; a dead child reconciles to failed; `resume` is explicit; cancel terminates the process group; ACP sessions keep subagents inactive.
  - Rationale: Durable delegation must not become an untracked process leak.

- [x] R34: Subagent configuration, agent format, actions, durability, write lock, and security limits are documented.
  - Verify: README checks cover `subagents.json`, agent frontmatter, actions, state and socket locations, trust, depth, and recovery.
  - Acceptance: Users can audit concurrency/cost bounds and where prompts and results are stored.
  - Rationale: Operators need to understand the process and permission surface before enabling delegation.

- [x] R35: Detached process lifecycle, state, logs, cancellation, and Unix sockets have one shared implementation used by both durable shell tasks and subagents.
  - Verify: Process package tests plus `pi-tasks` and `pi-subagents` suites cover spawn, persistence, reconciliation, cancel, JSONL framing, and permissions.
  - Acceptance: One lifecycle owner; no duplicated runner; state/log/socket permissions; PID/start-time reconciliation; request/response socket framing.
  - Rationale: Two durable subsystems must not drift in cleanup or state semantics.

### Sticky widget, context, access, and budgets

- [x] R36: Todos managed via `pi-todos` render as a sticky widget above the prompt box alongside running subagents.
  - Verify: Sticky widget renders todos and subagents above the editor; no statusline/dashboard segment required.
  - Acceptance: `todo` updates and `/todo` commands refresh the sticky widget above the prompt box; displays todos and subagent execution states (running, blocked, complete).
  - Rationale: Sticky rendering keeps active task and subagent state visible without separate dashboard UI.

- [x] R37: A `/context` command breaks down context-window usage by category.
  - Verify: Command output lists agent thinking, agent output, user input, tool output, tool input, system prompt, and skills with token counts.
  - Acceptance: Running `/context` shows per-category token usage and total against the window limit; no UI dependency required.
  - Rationale: Visibility into context composition helps diagnose bloat and compaction.

- [x] R38: Out-of-workspace access is gated by trusted roots and user approval.
  - Verify: Access outside the workspace prompts or is denied per root trust; no silent allow.
  - Acceptance: Untrusted roots fall back to the asking scheme; trusted roots allow access; decisions can be session-only or indefinite.
  - Rationale: Prevents silent out-of-workspace reads while keeping legitimate cross-root workflows usable.

- [x] R39: Budgets and usage are tracked in dollars using provider pricing, surviving compaction.
  - Verify: Budget cap aborts on dollar threshold; usage report shows cost; compaction does not erase cumulative cost.
  - Acceptance: Provider pricing feeds `pi-usage`; optional caps set in $; usage accumulates $ across compaction.
  - Rationale: Dollar tracking matches real cost and survives context compaction.

### Modal editor, subagent model swap, web codemode, agent switcher, progress, and budget statusline

- [ ] R95: Agent selection happens inline from a slash-command prefix, and a default agent can be configured through an agent settings subcommand available under both agent command names.
  - Verify: `npx vitest run extensions/pi-agent/src`
  - Acceptance: typing an agent command prefix lists matching agents with descriptions inline and inserts the chosen name without opening a popup; a default agent chosen in settings survives restart; both agent command aliases expose the same settings; no agent instructions are injected into the system prompt.
  - Constraints: the default persists in the existing agent configuration store.
  - Non-goals: a new config file format or an @ mention trigger.
  - Rationale: the popup hides the prompt and the default agent was previously file-only.

- [ ] R96: The statusline package no longer offers theme selection; color themes remain selectable through the host's own controls.
  - Verify: `npx vitest run extensions/pi-statusline/src`
  - Acceptance: statusline exposes no theme command or picker; all other statusline settings and segments keep working; theme changes are not persisted by statusline code.
  - Constraints: removal must not change host theme handling.
  - Non-goals: replacing the host theme picker.
  - Rationale: theme selection belongs to the host, and the statusline picker duplicated persistence behavior.

- [ ] R101: A default mode can be configured through a settings subcommand on the mode command and persisted in the existing mode configuration.
  - Verify: `npx vitest run extensions/pi-modes/src`
  - Acceptance: a default mode chosen in settings applies to new sessions; a resumed session keeps its recorded mode; the setting is rejected when it names an unknown mode and reports the reason; all mode command aliases expose the same settings.
  - Constraints: the existing session mode always takes precedence over the configured default.
  - Non-goals: changing persisted session modes or a new config format.
  - Rationale: mode defaults were previously implicit in code rather than user-configurable.

- [ ] R102: The active mode is visible in the prompt window's bottom-left status row, and a TUI setting can hide that indicator while the mode extension is loaded.
  - Verify: `npx vitest run extensions/pi-modal/src extensions/pi-modes/src`
  - Acceptance: the current mode appears bottom-left in the prompt row alongside the insert indicator when the mode extension is active; a TUI setting hides only that prompt indicator; other statusline segments and mode switching remain unchanged; toggling the setting takes effect without an extension reload.
  - Constraints: the setting is owned by the TUI configuration surface even though it controls a mode-owned indicator.
  - Non-goals: removing the statusline mode segment or the mode popup.
  - Rationale: users expect vim-style mode feedback in the prompt, with an opt-out for a clean input row.


- [x] R40: A configurable modal editor extension (`pi-modal`) provides Vim navigation with global user keybindings.
  - Verify: Editor handles normal, insert, and visual modes; keys map to Vim defaults and can be overridden via `~/.pi/agent/modal.json`.
  - Acceptance: Switching modes changes cursor and border badge; commands and navigation execute in normal/visual mode; typing inserts in insert mode; custom keymaps load exclusively from global user config.
  - Rationale: Keyboard-driven modal editing improves prompt authoring ergonomics in terminal environments without project pollution.

- [x] R41: Subagent model failures trigger an interactive swap prompt without allowing caller tool overrides.
  - Verify: Failing/broken subagent models trigger `ctx.ui.select` populated from Pi's active runtime models and session model fallback; subagent tool input rejects caller model mutation.
  - Acceptance: Subagents honor frontmatter `model` definitions; when a model fails or is unresolvable, the user is prompted to swap it using available runtime models; main agent cannot override subagent models in tool calls.
  - Rationale: Keeps subagent model governance under user control while recovering gracefully from broken or rate-limited endpoints.

- [x] R42: Web search and fetch are exposed exclusively through codemode with zero-cost model pricing support.
  - Verify: Tools declare `exposure: "codemode"` without direct tool exposure; QuickJS scripts can execute multi-query fetch pipelines; `:free` models evaluate to $0.00 cost.
  - Acceptance: `web_search` and `web_fetch` are callable only via `tools.*` in `codemode` without prompt declaration overhead; free model tags produce 0 dollar accrual.
  - Rationale: Pure programmatic tool execution eliminates multi-turn latency and prompt bloat while pricing accurately tracks zero-cost models.

- [x] R43: Agent switcher isolates agent profiles with session auto-forking and dynamic skill filtering.
  - Verify: `/agent <name>` forks ongoing session, renames session title, labels branch point, filters declared skills, and injects system prompt.
  - Acceptance: `pi-agent` discovers user and project agent markdown files; switches fork the session tree when history exists and update the title to `[<agent>] ...`; frontmatter `skills` explicitly filters available skills; modal overlay displays agent details; `/agent default` resets profile.
  - Rationale: Agent specialization requires distinct system prompts, skills, and tools without polluting or desynchronizing parent conversation branches.

- [x] R44: Subagents inherit parent mode permissions with frontmatter fallback, and progress displays live execution state and active tool duration.
  - Verify: Tests cover mode priority (parent mode overrides frontmatter, ask mode falls back to frontmatter), pi-guard subagent passthrough vs mode gating, and sticky widget subagent format `@<id> <mm:ss> (<task>) <status> · <tool> <tool_duration>`.
  - Acceptance: `subagent` actions `list`, `status`, `wait`, `cancel` are passthrough in `pi-guard`; `start`, `send`, `resume` follow active mode; child process enters parent mode when non-default, else frontmatter `mode`; `pi-subagents` emits state on tick and tool events; `pi-todos` formats active subagent elapsed time and running tool duration.
  - Rationale: Transparent subagent execution tracking and mode enforcement prevent runaway child executions and provide clear progress visibility.

- [x] R45: Budget statusline compact display and detailed widget panel.
  - Verify: Statusline renders the `pi-usage` cap ratio when a cap is active and stays empty without one; `/usage` renders the detailed token and dollar breakdown; verbose budget status output is removed.
  - Acceptance: The `cost` component shows dollar usage; the `usage` provider shows the cap ratio only when a cap is active; `/usage` shows the detailed token and dollar breakdown; turn completions update both without chat or footer clutter.
  - Rationale: Concise statusline tracking keeps costs visible without consuming prompt or chat real estate.

### Visual mode, prompt decoration, sandbox, todo management, panel toggle, todo CRUD, task logs/deps, modal search, usage merge, subagent pause/steer, web cache

- [x] R46: Vim visual mode text selection and clipboard operations in modal editor.
  - Verify: Pressing `v` enters visual mode; movements (`h`, `j`, `k`, `l`, `0`, `$`, `w`, `b`) expand or contract highlighted text selection; `y` copies selection to clipboard and returns to normal mode; `d`/`x` cuts selection and returns to normal mode; `c` cuts and enters insert mode.
  - Acceptance: Selected text renders with distinct visual highlight; yank puts text on system/terminal clipboard; delete removes text; escape or `v` cancels selection.
  - Rationale: Full vim visual selection ergonomics allow precise prompt editing without leaving the terminal keyboard layout.

- [x] R47: Configurable prompt decoration character and rounded box borders.
  - Verify: Modal prompt renders configured single prompt character (defaulting to `❯`); sticky todos widget, agent modal, and popup dialogs render with rounded corner characters (`╭`, `╮`, `╯`, `╰`).
  - Acceptance: Prompt character defaults to `❯` and can be customized to any single character; box borders use rounded Unicode box-drawing characters consistently across all UI elements.
  - Rationale: Consistent rounded borders and a clean prompt indicator provide modern, polished terminal ergonomics.

- [x] R48: Bubblewrap OS-level command execution sandboxing.
  - Verify: Extension-run commands and background tasks run under `bwrap` restricting filesystem access outside the workspace; attempts to read or write sensitive directories (e.g. `~/.ssh`, `~/.gnupg`, `/etc`) are blocked; workspace reads and writes succeed cleanly; the built-in shell tool and the whole Pi process are documented as requiring an outer container.
  - Acceptance: Sandboxed execution uses system `bwrap`; workspace directory is read-write; system binaries and libraries are read-only; user secrets are isolated; failure or missing sandbox fails closed; the built-in shell tool and whole-process boundaries are explicit.
  - Rationale: OS-level user namespace sandboxing protects host credentials and filesystems against untrusted shell commands without container daemon overhead.

- [x] R49: Guarded todo deletion for assistant and flexible todo management for users.
  - Verify: Assistant `delete_todos` block succeeds only when all todos are marked done, failing or rejecting if any todo remains open; `/todo complete <id>`, `/todo delete <id>`, and `/todo delete` commands let users complete or remove any todo at any time.
  - Acceptance: Incomplete todos block agent-triggered bulk deletion; user slash commands allow explicit deletion and completion; deleted todos are removed from the sticky widget immediately.
  - Rationale: Guarding agent deletion prevents accidental premature task clearing while leaving full interactive control in user hands.

- [x] R50: Prefixed keybinding and command toggle for sticky panels with unified task and subagent formatting.
  - Verify: Pressing `Ctrl+X` followed by `p` (`^x p`) or running `/panel toggle` toggles sticky panel visibility; tasks and subagents render with matching styling showing ID, elapsed time, status, and active command/tool.
  - Acceptance: `^x p` hides or reveals sticky widgets (todos, tasks, subagents); background tasks and subagents display consistent metadata fields; hidden state persists across prompt submissions in the session.
  - Rationale: Hotkey toggle and consistent panel formatting preserve vertical screen space on demand while unifying execution state visualization.

- [x] R51: `pi-todos` supports editing todo text, priority levels, bulk completion, and search/filter.
  - Verify: `npx vitest run extensions/pi-todos/src/todos.test.ts extensions/pi-todos/src/index.test.ts`
  - Acceptance: `/todo edit <id> <text>` renames a todo; priority (high/medium/low) displays and sorts; `/todo complete all` marks all done; `/todos search <query>` filters by text.
  - Rationale: Todo management needs full CRUD beyond create/complete/delete to be useful for real task tracking.

- [x] R52: `pi-tasks` streams live output and supports task dependencies.
  - Verify: `npx vitest run extensions/pi-tasks/src/index.test.ts extensions/pi-tasks/src/registry.test.ts`
  - Acceptance: Running task output is tail-able via `/task logs <id>`; task B can declare dependency on task A and waits for A to finish before starting.
  - Rationale: Background tasks need observable output and ordering for multi-step workflows.

- [x] R53: `pi-modal` adds search/replace, syntax highlighting, and visual selection highlighting.
  - Verify: `npx vitest run extensions/pi-modal/src/index.test.ts`
  - Acceptance: `/` searches buffer with `n`/`N` navigation; `:%s/old/new/g` replaces; code blocks get language-aware highlighting; visual selection renders with distinct background.
  - Rationale: Vim modal editing needs search and highlighting to be productive.

- [x] R54: `pi-usage` absorbs `pi-budgets`, tracks per-model cost breakdown, cache tokens, and subagent usage.
  - Verify: `npx vitest run extensions/pi-usage/src/index.test.ts`
  - Acceptance: `/usage` shows a per-model token and cost table; cache read/write tokens are tracked; the optional USD cap warns at 80% and blocks at 100%; token caps are not supported; `pi-autopilot` does not require a cap.
  - Rationale: Unified usage and budget tracking prevents duplicate accounting and gives complete cost visibility.

- [x] R55: `pi-subagents` supports pause/resume and steering messages.
  - Verify: `npx vitest run extensions/pi-subagents/src/index.test.ts extensions/pi-subagents/src/runner.test.ts`
  - Acceptance: `/subagent pause <id>` suspends a running subagent; `/subagent resume <id>` continues it; the parent can send a steering message to a paused or completed subagent to redirect its next turn.
  - Rationale: Pause and steer let the user course-correct long-running subagents without losing context.

### Dashboard, language hover, statusline clicks, agent validation, hooks async, question paging, guard grants, animation, modal borders, tasks foundation, subagent harnesses, usage attribution

- [x] R56: `pi-web` adds response caching, rate limiting, and content-type negotiation.
  - Verify: `npx vitest run extensions/pi-web/src/fetch.test.ts extensions/pi-web/src/tools.test.ts`
  - Acceptance: Repeated fetches of the same URL within TTL return cached response; requests exceeding rate limit are queued; `Accept` header negotiates JSON/HTML/text based on tool intent.
  - Rationale: Caching and rate limiting reduce redundant network calls and avoid provider throttling.

- [x] R57: `pi-dashboard` adds error recovery, interactive refresh, and custom renderers.
  - Verify: `npx vitest run extensions/pi-dashboard/src/index.test.ts extensions/pi-dashboard/src/render.test.ts`
  - Acceptance: Failed sections retry with backoff; pressing a key refreshes a section; custom TS render functions and inline images are supported in sections.
  - Rationale: Dashboard needs resilience and extensibility for real monitoring use.

- [x] R58: `pi-language-tools` adds hover info as both tool result and optional TUI popup.
  - Verify: `npx vitest run extensions/pi-language-tools/src/tool.test.ts extensions/pi-language-tools/src/index.test.ts`
  - Acceptance: `hover` tool returns type/signature/docs to the model; optional TUI popup shows the same info at cursor position when UI is available.
  - Rationale: Hover info helps both the model and user understand code without leaving the editor.

- [x] R59: `pi-statusline` adds configurable click handlers; custom TS component loading is deferred to backlog.
  - Verify: `npx vitest run extensions/pi-statusline/src/index.test.ts extensions/pi-statusline/src/components.test.ts`
  - Acceptance: Clicking a segment runs a configurable action (default: open relevant report); custom ComponentFn loading is not yet implemented.
  - Rationale: Clickable segments make the statusline an interactive control surface; the custom loader contract remains open.

- [x] R60: `pi-agent` validates agent configs on load and reports errors.
  - Verify: `npx vitest run extensions/pi-agent/src/agents.test.ts extensions/pi-agent/src/index.test.ts`
  - Acceptance: Missing required fields, invalid model references, and unknown modes produce clear validation errors; invalid agents are skipped with a warning, not silently ignored.
  - Rationale: Validation prevents silent misconfiguration of agent definitions.

- [x] R61: `pi-hooks` adds async hook chains, conditional hooks, output formatting, and timeout config.
  - Verify: `npx vitest run extensions/pi-hooks/src/hooks.test.ts extensions/pi-hooks/src/index.test.ts`
  - Acceptance: Hooks can chain (output of one feeds next); hooks can be conditionally skipped based on tool name or path; hook output is formatted (markdown/plain); timeout is configurable per hook.
  - Rationale: Hook extensibility needs chaining and conditional execution for complex workflows.

- [x] R62: `pi-question` supports multi-page questions and conditional branching.
  - Verify: `npx vitest run extensions/pi-question/src/questions.test.ts extensions/pi-question/src/index.test.ts`
  - Acceptance: Questions can span multiple pages with Next/Back navigation; answer to question A can conditionally show/hide question B; all questions remain in the context window only (no persisted history).
  - Rationale: Multi-page and conditional questions handle complex decision trees without overwhelming the user.

- [x] R63: `pi-guard` supports temporary permission grants.
  - Verify: `npx vitest run extensions/pi-guard/src/index.test.ts extensions/pi-guard/src/rules.test.ts`
  - Acceptance: `/grant <path-or-tool> <duration>` temporarily allows a denied action; grant expires after duration or session end; grants are visible via `/grants`.
  - Rationale: Temporary grants let users unblock one-off operations without permanently weakening policy.

- [x] R64: Agent processing and background tasks show an animated working indicator.
  - Verify: `npx vitest run extensions/pi-tasks/src/index.test.ts extensions/pi-statusline/src/index.test.ts`
  - Acceptance: During agent streaming, a spinner animation with elapsed timer is visible; background tasks show animated progress; animation respects `prefers-reduced-motion` and can be disabled via config.
  - Rationale: Animated indicators prevent users from wondering if the agent is stuck or errored.

- [x] R65: `pi-modal` supports configurable border styles on the prompt window.
  - Verify: `npx vitest run extensions/pi-modal/src/index.test.ts`
  - Acceptance: `modal.json` accepts `borderStyle` (rounded, double, dashed, sharp, none); default is rounded; borders render on the right side only; left side stays clean.
  - Rationale: Configurable borders let users match their terminal aesthetic without losing the clean left edge.

- [x] R66: `pi-tasks` is the foundation for durable task lifecycle used by `pi-subagents`.
  - Verify: `npx vitest run extensions/pi-tasks/src extensions/pi-subagents/src`
  - Acceptance: `pi-tasks` exports an atomic `TaskStore` and detached-spawn helper; `pi-subagents` depends on `@hollowheap/pi-tasks` for host-side subagent state and runner spawning; the detached JS shim keeps its own minimal atomic state write because it cannot import TypeScript.
  - Rationale: One lifecycle owner keeps shell tasks and subagents consistent.

- [x] R67: Subagents can run through named generic CLI harnesses in addition to the default Pi RPC child.
  - Verify: `npx vitest run extensions/pi-subagents/src/config.test.ts extensions/pi-subagents/src/tool.test.ts extensions/pi-subagents/src/runner.test.ts`
  - Acceptance: `subagents.json` validates `harnesses` with command, args, stdin/arg input, and env; agent frontmatter selects `harness`; generic harnesses receive the system prompt and task as plain text, support raw steering, and reuse wait/cancel/resume; Pi remains the default with RPC steering and session continuation.
  - Rationale: A configurable command seam covers other harnesses without vendor-specific flags in code.

- [x] R68: `pi-usage` attributes usage from subagents launched by the current parent session.
  - Verify: `npx vitest run extensions/pi-usage/src/index.test.ts extensions/pi-subagents/src/index.test.ts`
  - Acceptance: `/usage` lists each Pi subagent by id, agent, model, tokens, and USD cost; the same spend rolls into per-model and session totals; subagent spend counts toward the parent `/usage cap`; generic CLI subagents show usage unavailable and are excluded from totals; child spend is refreshed when a child completes and before the parent starts its next turn; parent-session scoping prevents other sessions' subagents from leaking into the report; resume does not double-count a child session.
  - Rationale: Subagent work is part of the real cost of a parent turn, so it belongs in the same budget and attribution surface.

### External alerts

- [x] R69: Long-running work can alert the user outside the terminal, and the user can choose which events alert.
  - Verify: Acceptance: configured completion, error, question, task, and subagent events alert; unselected events remain silent.
  - Acceptance: Alerts fire outside the terminal; event selection is user-configurable; duplicate and focused-session noise is suppressed.
  - Rationale: External alerts require user opt-in and must stay out of the model loop.
  - Constraints: Alerts never block the agent or add a model tool.
  - Non-goals: No alert history or delivery receipts.

- [x] R70: Alerts never expose prompt, task, or tool content, and unsupported platforms degrade safely.
  - Verify: Tests assert payloads contain only event and status identifiers; a missing notifier produces a diagnostic and terminal fallback.
  - Acceptance: Sensitive text is excluded; an unsupported platform does not fail the agent; the user sees the fallback.
  - Rationale: Privacy and graceful degradation are required for any out-of-terminal notification.
  - Constraints: No secrets in alert payloads; terminal fallback needs no new dependency.
  - Non-goals: No guarantee that every OS notifier is available.

- [x] R74: Task and subagent completion emit the configured external completion alert without duplicate delivery.
  - Verify: `npx vitest run extensions/pi-tasks/src/alerts.test.ts extensions/pi-subagents/src/alerts.test.ts`
  - Acceptance: One completion alert fires per task or subagent; permission/ask stays in-terminal; payloads remain IDs and status only.
  - Rationale: Completion alerts must not duplicate or interfere with task/subagent completion.
  - Constraints: No model tool; alert failure cannot fail the task or subagent.
  - Non-goals: Alert history, retries, or delivery receipts.
- [x] R75: Question prompts and agent completion emit external alerts without exposing prompt or task text.
  - Verify: `npx vitest run extensions/pi-question/src/alerts.test.ts extensions/pi-statusline/src/alerts.test.ts`
  - Acceptance: A question prompt emits one alert; agent completion emits one alert; payloads contain only event and status identifiers.
  - Constraints: No model tool; alert failure cannot block the question or agent.
  - Non-goals: Alert history, retries, or delivery receipts.

### Isolated workspaces

- [x] R71: Concurrent task and subagent work can use isolated workspaces when explicitly enabled, without changing the default single-writer behavior.
  - Verify: Tests cover concurrent isolated writers, explicit integration, cleanup on success/error/shutdown; the default write lock remains single-writer.
  - Acceptance: Isolation is opt-in; concurrent changes do not collide; integration is explicit; cleanup leaves no orphan workspace.
  - Rationale: Opt-in isolation avoids changing existing single-writer behavior.
  - Constraints: No automatic merge or remote workspaces; the default remains the current write lock.
  - Non-goals: Automatic conflict resolution; whole-agent process isolation.

- [x] R73: Task and subagent start accept an explicit isolated-workspace option and clean the workspace on completion, error, or cancel.
  - Verify: `npx vitest run extensions/pi-tasks/src/task-tool.test.ts extensions/pi-subagents/src/tool.test.ts extensions/pi-tasks/src/workspace.test.ts extensions/pi-subagents/src/workspace.test.ts`
  - Acceptance: `isolated: true` uses a separate workspace; omitted/false uses the shared cwd; terminal states remove the isolated workspace; no orphan remains.
  - Rationale: Explicit workspace cleanup prevents orphaned state.
  - Constraints: Default behavior unchanged; no automatic merge or remote workspace.
  - Non-goals: Workspace UI, conflict resolution, or whole-agent isolation.

### Web fetch hardening

- [x] R72: Web fetch rejects private network destinations after DNS resolution, bounds response reads, and search fallback advances when a provider returns no results.
  - Verify: Acceptance: `localtest.me`/`nip.io` are rejected; oversize bodies stop at the cap; empty provider results advance; existing tool shapes remain unchanged.
  - Acceptance: Private and reserved DNS targets are blocked on every hop; body reads are capped; empty provider results advance; no private fetch or unbounded buffering.
  - Rationale: DNS rebinding and unbounded reads are security and performance risks.
  - Constraints: No new provider dependency; the local tool contract stays unchanged.
  - Non-goals: Upstream providers, PDF/YouTube extraction, or GitHub clone support.

### Imported subagent runs

- [x] R76: Async subagent runs from another engine can appear in the local panel with the same state fields.
  - Verify: `npx vitest run extensions/pi-subagents/src/upstream.test.ts`
  - Acceptance: Active runs map to local IDs, agent/label, state, start time, and active tool; terminal runs are omitted.
  - Constraints: No runtime dependency on the other engine; no task text is required.
  - Non-goals: Bidirectional control, steering, or resume across engines.

### Media content

- [x] R77: A fetched PDF URL yields readable text, not an empty response.
  - Verify: `npx vitest run extensions/pi-web/src/pdf.test.ts extensions/pi-web/src/fetch.test.ts`
  - Acceptance: PDF text is extracted locally, capped, and returned as content; malformed or oversized PDFs return explanatory text; no browser or upstream engine.
  - Constraints: No upstream web engine; extraction failure must not crash the tool.
  - Non-goals: Scanned-image OCR, PDF rendering, or attachment downloads.

- [x] R78: A fetched direct image URL yields bounded image content for the model.
  - Verify: `npx vitest run extensions/pi-web/src/image.test.ts extensions/pi-web/src/tools.test.ts`
  - Acceptance: Supported image bytes return one image block with MIME type and a size cap; unsupported or oversized images return explanatory text; terminal previews remain.
  - Constraints: No upstream web engine; no SVG or unbounded payloads.
  - Non-goals: Video/audio content or image OCR.

### Session subagent definitions

- [x] R79: A caller can define a subagent that exists only in the current session and start it by name.
  - Verify: `npx vitest run extensions/pi-subagents/src`
  - Acceptance: `define` requires `name` and `systemPrompt`; the definition persists as a session custom entry; session start and tree navigation restore it from the active branch; a session definition shadows a file agent with the same name; no agent file is written; invalid entries are ignored.
  - Constraints: Definitions are branch-local and stored only in session history.
  - Non-goals: Global definitions, definition file editing, or a definition management UI.

- [x] R80: A caller can delete session definitions without touching file agents, and new definitions are bounded by config.
  - Verify: `npx vitest run extensions/pi-subagents/src extensions/pi-guard/src packages/policy/src`
  - Acceptance: `delete` removes only names present in the session map and appends a tombstone that survives branch restore; file-only names fail; `maxSessionAgents` and `maxSessionAgentBytes` reject new over-limit definitions; redefining an existing name does not consume another slot; invalid config values diagnose and fall back.
  - Constraints: Limits apply to new definitions; existing session entries remain readable.
  - Non-goals: Deleting file agents, editing agent files, or global definition management.

### Observational memory

- [x] R81: An opt-in observer distills durable memory into session entries and carries it through compaction without hiding model spend.
- [ ] R90: Observations track a `coversUpToId` watermark so coverage of source entries is known.
  - Verify: `npx vitest run extensions/pi-memory/src`
  - Acceptance: each observation records the last source entry id it covers; `/memory status` reports coverage (covered/total pending); deterministic compaction is allowed only when coverage is complete before the cutoff.
  - Constraints: watermark is branch-local and survives tree navigation; partial coverage blocks deterministic mode.
  - Non-goals: deterministic compaction itself (R91).
- [ ] R91: Memory written in one session is available to later sessions in the same workspace, and a bounded query returns what earlier compactions discarded.
  - Verify: `npx vitest run extensions/pi-memory/src`
  - Acceptance: an observation saved in one session is found by a later session in the same workspace; workspace resolution uses the nearest project marker directory and otherwise the repository root; results carry session and workspace origin, respect redaction, and are bounded; the existing memory status and view surfaces show workspace counts and entries with session scope as the default filter; a codemode-only query surface exposes the workspace scope.
  - Constraints: branch-local session memory and its consumed marker stay intact; cross-session entries are never written to a global store shared by unrelated workspaces.
  - Non-goals: a handoff command, automatic branching, a dashboard section, or memory shared across all workspaces.
  - Rationale: compaction loses details after several sessions; durable workspace memory lets the agent requery what mattered ten sessions ago.
- [ ] R92: Observer and compaction spend is measured and surfaced in `/memory status` and the usage ledger.
  - Verify: `npx vitest run extensions/pi-memory/src extensions/pi-usage/src`
  - Acceptance: observer cost appears in `/memory status` (already partial); compaction cost counted; totals agree with usage ledger.
  - Constraints: pricing stays per message model (R39).
  - Non-goals: reconciling with provider invoices.
  - Verify: `npx vitest run extensions/pi-memory/src extensions/pi-usage/src`
  - Acceptance: disabled by default; requires an explicit provider/model; observes only unconsumed messages after the token threshold; stores branch-local observations and consumed markers; restores on session start and tree navigation; injects active memory into `session_before_compact`; supports `/memory status`, `/memory view`, and `/memory clear`; redacts common credentials by default; records observer usage in the shared ledger; ACP registers nothing.
  - Constraints: No dependency on `pi-observational-memory` and no separate memory file. Redaction is best-effort.
  - Non-goals: Reflector, dropper, `recall`, ongoing context injection outside compaction, or global memory across sessions.

### Review remediation

- [ ] R99: Shared animation, state-flush, and agent-name-resolution primitives expose consistent behavior across the surfaces that use them.
  - Verify: `npm test`
  - Acceptance: the thinking shimmer and panel spinner use one animation owner; state counters persist through the same lifecycle hook in every slice that records them; agent names resolve through one diagnostic-bearing resolver for parent and child rosters.
  - Constraints: each primitive lives in the shared package that already owns its concern.
  - Non-goals: a universal state store or a single abstraction for unrelated tool renderers.
  - Rationale: review found three independent copies of each concern, and the fixes would otherwise drift again.

- [x] R82: Irreversible shell commands always ask for approval in every mode unless a user rule explicitly allows that command.
  - Verify: `npm test`
  - Acceptance: recursive deletes under the home or root directory, `find ... -delete`, and forced pushes ask in ask, edit, and autopilot modes; an explicit user allow rule for the exact command runs it without asking; mode overrides cannot remove the approval.
  - Constraints: Approval must not depend on the interactive UI; non-interactive modes block instead of running.
  - Non-goals: Full shell semantic analysis or sandboxing of built-in `bash`.
  - Rationale: V38-F2 shows autopilot runs `rm -rf ~` without a prompt.

- [x] R83: A permission deny is never overridden by a broader allow, a trusted parent directory, or a read approval.
  - Verify: `npm test`
  - Acceptance: a deny on a file holds when its parent directory is allowed for the session, allowed indefinitely, or trusted; a read approval never permits a write; home-relative and `@`-prefixed paths are judged at the path the tool will touch; a permission file that cannot be parsed makes every gated tool ask and shows a notice in every mode.
  - Constraints: Existing allow rules keep working for paths without a deny.
  - Non-goals: New rule syntax.
  - Rationale: V22-F1/F2 and V29-F1/F2/F4 show four deny bypasses.

- [x] R84: Changing a setting never deletes or rewrites user configuration that the extension could not parse.
  - Verify: `npm test`
  - Acceptance: when a settings file exists but does not parse, a settings change is refused, the file stays byte-identical, and the user sees the file path and the reason; a valid file keeps every field the change does not touch.
  - Constraints: Writes that succeed replace the file atomically.
  - Non-goals: Automatic repair or backup of broken files.
  - Rationale: V25-F3, V27-F3, V29-F6, and V34-F7 delete user config.

- [x] R85: Text from models, tasks, commands, or configuration cannot move the cursor or change the terminal title, clipboard, or screen.
  - Verify: `npm test`
  - Acceptance: escape, OSC, and other control bytes in model output, task output, command output, agent names, and approval text render as inert characters or are removed; extension styling still shows its colors.
  - Constraints: Text sent to the model is unchanged.
  - Non-goals: Rendering colors that come from untrusted text.
  - Rationale: Seven reviews found raw control bytes reaching the terminal.

- [x] R86: Cancelling, timing out, or shutting down never leaves a child process running.
  - Verify: `npm test`
  - Acceptance: after cancel, timeout, abort, session shutdown, or reload, no descendant of a task, subagent, hook, language server, dashboard command, or ACP session remains; a child that ignores the terminate signal is force-killed after a grace period; the reported state is `cancelled` for a user cancel.
  - Constraints: Detached tasks and subagents still survive a normal parent exit by design.
  - Non-goals: Killing processes that a child intentionally re-parents outside its process group.
  - Rationale: V21, V24, V26, V31, and V37 leave orphan processes.

- [x] R87: A dismissed, aborted, or replaced dialog never blocks later prompts.
  - Verify: `npm test`
  - Acceptance: when a dialog is hidden by the host, aborted, timed out, or its session is replaced, the next dialog opens; an unanswered dialog with a configured timeout resolves as cancelled.
  - Constraints: Only one dialog is open at a time (R29).
  - Non-goals: Parallel dialogs.
  - Rationale: V20-F1, V22-F4/F5, and V36-F9 show a permanent prompt hang.

- [x] R88: One model call shows the same dollar cost in every report, and every billed call counts toward the budget cap.
  - Verify: `npm test`
  - Acceptance: the usage report, statusline, subagent rows, observer, and classifier totals agree for the same call; classifier and observer calls, including failed billed calls, count toward the cap; a cached result is not counted again; restore uses only the active branch.
  - Constraints: Pricing stays per message model (R39).
  - Non-goals: Reconciling with provider invoices.
  - Rationale: V33-F1/F3 and V35-F1/F3 show inconsistent and double-counted costs.

### Subagent harnesses (recorded backlog)

- [ ] R89: `pi-subagents` tasks can select a configured harness communicating over ACP or headless mode.
  - Verify: `npx vitest run extensions/pi-subagents/src`
  - Acceptance: `subagent` `start` accepts an optional `harness` override alongside agent defaults; `subagents.json` distinguishes configurable `headless` (subprocess CLI / Pi RPC) and `acp` client harness transports; chosen harness metadata persists in subagent run state so `send`, `status`, and `resume` stay consistent and process-group teardown (R86) holds.
  - Constraints: Recorded only (`2026-11-16`) per user direction; preserve existing `pi` RPC and headless `command`/`args`/`input` harness configs and trust/sandbox boundaries.
  - Non-goals: Implementing ACP client transport in `pi-subagents` right now.
  - Rationale: `extensions/pi-subagents/src/tool.ts` only reads `harness` from `define`/agent config (`tool.ts:101-130, 257-259`), and `extensions/pi-subagents/src/config.ts` only configures headless subprocess `harnesses` (`stdin`/`arg`).

### Dashboard and TUI settings ownership

- [ ] R103: TUI settings are contributed only by extensions that are loaded, and a disabled or absent extension contributes no settings entries.
  - Verify: `npx vitest run extensions/pi-modal/src extensions/pi-modes/src`
  - Acceptance: a setting appears only while its owning extension is loaded; unloading or disabling the owner removes the entry without a reload of unrelated settings; the mode indicator visibility setting appears only with the mode extension present.
  - Constraints: contribution happens at load time through one shared registration surface.
  - Non-goals: a global static settings list with availability flags.
  - Rationale: settings for absent extensions are dead configuration and clutter.

- [ ] R104: The dashboard's recent-session list shows each session once, ordered by recency, and reflects session changes without a manual reload.
  - Verify: `npx vitest run extensions/pi-dashboard/src`
  - Acceptance: duplicate session ids are collapsed; newest sessions appear first; creating or switching a session updates the list; the configured scope still filters the result.
  - Constraints: refresh is bounded and stops when the dashboard closes.
  - Non-goals: a paginated session browser.
  - Rationale: stale or duplicated sessions make the dashboard misleading.

- [ ] R105: Dashboard quick actions offer model, thinking, and session switching only; todo, agent, grant, and settings actions are removed.
  - Verify: `npx vitest run extensions/pi-dashboard/src`
  - Acceptance: the quick-action overlay lists exactly model, thinking, and sessions; selecting sessions leaves the dashboard; no todo, agent, grant, or settings actions appear.
  - Constraints: section visibility still follows configuration.
  - Non-goals: a new settings or agent surface inside the dashboard.
  - Rationale: those actions belong to their owning extensions; the dashboard should navigate, not duplicate controls.

- [ ] R106: Context, skills, and extensions render as distinct dashboard sections, each with its own count and empty state.
  - Verify: `npx vitest run extensions/pi-dashboard/src`
  - Acceptance: the three kinds appear as separate sections rather than one mixed list; each shows a count and a meaningful empty state; section order and visibility follow dashboard configuration.
  - Constraints: each section renders nothing when absent from the configured list or disabled.
  - Non-goals: a detailed browser for any of the three.
  - Rationale: mixing unrelated builtins in one list makes the dashboard unreadable.

- [ ] R107: Dashboard settings control every section through one ordered list, where position defines display order and an absent or disabled entry hides the section.
  - Verify: `npx vitest run extensions/pi-dashboard/src`
  - Acceptance: moving an entry changes display order; removing an entry hides it; `enabled: false` hides a section while keeping its entry and options; entries carry section-specific options such as limits; an empty or missing list falls back to the default order.
  - Constraints: the setting replaces the default list rather than merging into it.
  - Non-goals: a separate numeric order field or a name-to-config map.
  - Rationale: an ordered list matches the established dashboard configuration model and keeps order and visibility in one place.

### Input modes, verbosity, widgets, and task/subagent surfaces

- [ ] R108: Navigation-only overlays enter normal mode when the modal editor is active, and every overlay that accepts text reuses the prompt draft stash.
  - Verify: `npx vitest run extensions/pi-modal/src extensions/pi-question/src extensions/pi-agent/src`
  - Acceptance: selection overlays consume h/j/k/l for navigation and restore the prior editor mode on close; text overlays start in insert mode and preserve the exact draft; the prompt window itself starts in insert mode.
  - Constraints: one shared prompt-surface and mode-request seam between pi-modal and consumers.
  - Non-goals: mouse-driven navigation.
  - Rationale: vim users expect modal behavior to follow into overlays, and text overlays must not lose typed input.

- [ ] R109: The modal editor covers the basic vim motions and change operators, and the keybind reference lists them.
  - Verify: `npx vitest run extensions/pi-modal/src/keymap.test.ts extensions/pi-modal/src/vimkeys.test.ts`
  - Acceptance: w/b/e, 0/$, gg/G, dd, yy, p, u, and Ctrl-r are bound in normal mode and appear in `/vimkeys`.
  - Constraints: existing binds keep their behavior.
  - Non-goals: a full vim emulator.
  - Rationale: the current bind set omits common navigation and undo/redo operations.

- [ ] R110: The question flow defaults to insert mode, supports left/right navigation between answered questions, and shows an inline review with a final confirm.
  - Verify: `npx vitest run extensions/pi-question/src`
  - Acceptance: opening a question puts the prompt in insert mode; Escape from a free-text answer returns to the choice list; left/right move between answered questions without wrapping; the final review lists all answers with edit, confirm, and cancel.
  - Constraints: one dialog at a time (R29).
  - Non-goals: mouse navigation.
  - Rationale: text answers are the common case and need immediate input.

- [ ] R111: A subagent spawned by the main agent does not block its turn, and all children of a turn are cancelled when that turn ends.
  - Verify: `npx vitest run extensions/pi-subagents/src`
  - Acceptance: `subagent start` returns while the child runs; an explicit wait still blocks within the turn; when the spawning turn finishes, every child started in it is cancelled and reports `cancelled`.
  - Constraints: children remain durable across a normal parent exit unless the turn-end rule applies.
  - Non-goals: automatic resume after cancellation.
  - Rationale: current behavior can block the parent and leave children running after the turn.

- [ ] R112: Background tasks are guarded by the same permission policy as other tool calls.
  - Verify: `npx vitest run extensions/pi-tasks/src extensions/pi-guard/src`
  - Acceptance: starting a task resolves a permission verdict for its command before spawn; deny blocks, ask uses the existing approval transport, and headless blocks on ask; the task tool becomes callable from the parent agent.
  - Constraints: existing task state and runtime primitives stay unchanged.
  - Non-goals: per-command classifier evaluation for tasks beyond R93.
  - Rationale: the main agent never called the task tool and durable shell work bypassed approval.

- [ ] R113: Subagent rows show a stable `@role-index` label and a right-aligned elapsed time with reserved width that is never truncated.
  - Verify: `npx vitest run extensions/pi-subagents/src`
  - Acceptance: rows use `@engineer-1` style labels with a per-role index; elapsed time occupies a fixed right column in every row; narrow panels still show the full time.
  - Constraints: the label stays stable across status, send, and resume.
  - Non-goals: wall-clock start times.
  - Rationale: rows were hard to identify and the time column was cut off in narrow panels.

- [ ] R114: Todos, tasks, and subagents each render their own widget rows; the shared split panel is removed.
  - Verify: `npx vitest run extensions/pi-todos/src extensions/pi-tasks/src extensions/pi-subagents/src`
  - Acceptance: each extension owns one widget with its own border, visibility, and hotkey hint; no composite split panel remains; removing one extension leaves the others intact.
  - Constraints: existing statusline and dashboard state reads keep working.
  - Non-goals: a new composite widget.
  - Rationale: one owner of three kinds of state made each hard to toggle and read.

- [ ] R115: Temporary grants are listed through `/grant list`; the separate `/grants` command is retired.
  - Verify: `npx vitest run extensions/pi-guard/src`
  - Acceptance: `/grant list` shows active grants with expiry; `/grants` is no longer registered; other grant actions keep their behavior.
  - Constraints: persisted grant semantics unchanged.
  - Non-goals: a new grant store.
  - Rationale: two commands for one surface is redundant.

- [ ] R116: The sticky panel command is renamed to `/widget`, and each widget border shows the hotkey that hides it.
  - Verify: `npx vitest run extensions/pi-todos/src extensions/pi-modal/src`
  - Acceptance: `/widget toggle <name>` replaces `/panel`; each visible widget renders its hide hotkey in the border; the hotkey hides and restores the named widget; clicking a widget toggles its visibility.
  - Constraints: the command handles absent widget names with a diagnostic.
  - Non-goals: a widget picker popup.
  - Rationale: `/panel` is broken and the name no longer matches per-widget ownership.

- [ ] R117: Collapse and expand are one tui-owned controller with click affordances, and our verbosity setting overrides the host for thinking and tool output.
  - Verify: `npx vitest run packages/tui/src extensions/pi-modal/src`
  - Acceptance: one controller supplies expand/collapse state for panels, widgets, tool calls, and thinking; a `+` affordance means click to expand to high and `-` means click to collapse to low or medium; ctrl+o and ctrl+t route through our controller; ctrl+shift+o is retired; at low tool verbosity only the command one-liner shows.
  - Constraints: our setting always wins; thinking and tool verbosity are separate settings.
  - Non-goals: hotkey hints on collapsible surfaces.
  - Rationale: multiple owners produced inconsistent hints and stale host toggles.

- [ ] R118: The vim keybind reference is available in the host's builtin keybind section, and the standalone keybind command is retired.
  - Verify: `npx vitest run extensions/pi-modal/src`
  - Acceptance: the reference appears in the host keybind surface; no standalone keybind command is registered; the same bind data feeds that surface.
  - Constraints: no new keybind registry is introduced.
  - Non-goals: a separate keybind viewer.
  - Rationale: the host already exposes a keybind section; a second command duplicates it.

- [ ] R119: Fenced code blocks in our Markdown pager are syntax-highlighted when the language is supported and fall back to plain text otherwise; blockquotes keep a side border and lists keep styled bullets.
  - Verify: `npx vitest run packages/tui/src/pager.test.ts`
  - Acceptance: a TypeScript or Python fence renders colored tokens; an unsupported language renders plain text without an error; blockquote lines carry `│ ` and list items carry a bullet marker.
  - Constraints: reuse the host highlighter and its language validation.
  - Non-goals: adding new language grammars.
  - Rationale: the pager theme omitted the host's highlighter while the host renderer already supports it.
