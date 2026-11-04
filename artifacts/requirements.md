# Requirements

### Core runtime, policy, and consumers

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

- [x] R17: Questions are tool-free tagged blocks answered through UI dialogs.
  - Verify: `pi-question` tests pass.
  - Acceptance: Valid blocks parse, dialogs cancel safely, answers return as one follow-up, print/json stay inert.
  - Rationale: The user wanted questions in the response format, not a tool round trip.

- [x] R18: Todos are tool-free tagged blocks with branch-local state.
  - Verify: `pi-todos` tests pass.
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

- [x] R29: Interactive prompts across extensions are serialized so only one dialog or confirmation is open at a time.
  - Verify: Tests cover two concurrent prompt requests, FIFO order, release on resolve and rejection, and adoption by every current prompt site.
  - Acceptance: One process-wide queue; a second prompt waits; a failed or cancelled prompt releases the next; no new runtime dependency.
  - Rationale: Concurrent dialogs can overlap and steal input; one fair queue keeps prompts predictable.

### Subagents and durable process

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

- [x] R36: Todos created by tool-free blocks render as a sticky widget above the prompt box alongside running subagents.
  - Verify: Sticky widget renders todos and subagents above the editor; no statusline/dashboard segment required.
  - Acceptance: Tool-free tagged blocks update the sticky widget above the prompt box; displays todos and subagent execution states (running, blocked, complete).
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
