# Architecture

Last verified: 2026-11-18.
Scope: `my-pi-agent` workspace.

## System Shape

- Pi loads one extension per `extensions/pi-*` package through jiti with `moduleCache: false`; installed packages get separate module roots.
- `packages/core` owns shared policy, config, shell parsing, formatting, modes, session state, pricing, usage ledger, session caches, the prompt queue, and the live session snapshot bus (`@hollowheap/core/snapshot`).
- `packages/runtime` owns command execution, sandboxing, detached lifecycle, atomic state, logs, cancellation, PID/start-time reconciliation, and JSONL Unix-socket primitives.
- `packages/tui` owns reusable frames, pickers, pagers, cancellable progress, and the code viewer; it depends on core types and host TUI peers.
- `packages/policy` owns headless permission enforcement and shared tool-category/target helpers; `pi-guard` uses them for interactive approval and `pi-subagents` loads the headless extension for children.
- `packages/pi-acp` is a standalone ACP server plus a bundled extension. It runs one `pi --mode rpc -ne -e <ext> -nbt` child per session and routes execution through client capabilities.
- Durable shell tasks and subagents survive parent exit as detached children. `pi-subagents` uses `packages/runtime` and `packages/policy` primitives; ACP keeps subagents inactive.
- Trust boundaries are the project trust gate, agent-dir config, workspace path rules, provider network calls, and the ACP client.
- Permission handlers in the TUI, ACP, and headless children are the single decision boundary. A bounded classifier layer runs inside them after rule evaluation in every mode; it can block or route to the existing approval transport, and an unavailable classifier never becomes an allow (D186, D198, D200).
- `pi-question` and `pi-modal` compose one prompt surface: dialogs hide the editor, stash its draft, render in the prompt rows, and restore it on close (D187, D190). The active mode renders bottom-left in that prompt row, with a TUI-level visibility flag (D191).
- Workspace memory is scoped to the nearest project-marker directory, or the repository root when no marker exists. It survives sessions and compaction separately from branch-local observations (D189, D199).

## Module Seams

- `core` is the single policy/config/state owner; consumers keep UI, transport, and adapter behavior.
- `pi-guard` owns verdict prompts, bash truncation, `/mode`, `/context`, and `alt+m`; it does not parse rules. The shared classifier decision layer is invoked from the permission handlers in the TUI, ACP, and headless policy; it calls the model registry directly and never re-enters tools.
- `pi-modes` owns mode naming, `/mode` settings including the default mode, and the prompt-row mode indicator; persisted session modes outrank configured defaults. TUI configuration owns the indicator's visibility flag (D191, D196, D197).
- `pi-modal` owns the modal editor, `$` skill autocomplete, `/expand` tool-output persistence (`hollowheap.modal.expand`), mode-themed prompt borders, working indicator, rounded code viewer, vim keybind reference, and `ModalSnapshot`.
- `pi-tools` owns `/cd` (`hollowheap.core.cwd`) only. `pi-language-tools` owns the codemode-only `lang` LSP client, pooled servers, and `LspSnapshot`.
- The default active tool set excludes host `powershell` and `ls`; `bash` covers listing and shell work.
- `pi-hooks` owns session/pre/post hook execution, trusted project overlays, and `HooksSnapshot` / `hollowheap.hooks` stats.
- `pi-question` and `pi-todos` expose codemode tools (`question`, `todo`), keep widget/UI flows, and persist branch custom entries (`hollowheap.question.answers`, `hollowheap.todos`) plus live snapshots.
- `pi-tasks` owns durable shell tasks (`hollowheap.tasks.run`). `packages/runtime` owns `LockedProcessStore` and detached-spawn helpers; `pi-tasks` re-exports `TaskStore` for compatibility. `pi-subagents` owns child agents (`hollowheap.subagents.run`), harness selection, write locking, resume, and bounded, deletable session-only agent definitions.
- Upstream async subagent runs are mapper-only: a pure mapping feeds the panel; there is no runtime bridge or upstream dependency (D167).
- `pi-web` owns provider adapters, URL safety, and `hollowheap.web.history` / `WebSnapshot`; `pi-decide` owns the advisory `decide` tool and `DecideSnapshot`; `pi-agent` owns default-agent config startup/switching, inline agent completion, and the parent-side roster resolver; it no longer opens an agent picker popup (D188).
- `pi-statusline` owns footer rendering with git-repo `cwd` truncation and click dispatch. It no longer owns theme selection; host controls own themes (D195). `pi-dashboard` owns auto-hiding startup dashboard (`header`, `state`, `sessions`, `actions`, `terminal` sections) and interactive `/dashboard` session-resume/quick-action overlay.
- `pi-agent` owns inline agent completion under both agent command aliases, default-agent settings in the existing agent config, and the parent-side agent-name resolver. `pi-subagents` reuses the same resolver for child rosters; agent selection no longer opens a popup (D188, D192).
- `pi-usage` owns `/usage` presentation, subagent usage scanning, optional USD cap persistence, and the statusline usage provider; accounting, budget cap persistence, and compaction-safe state live in core.
- `pi-memory` owns opt-in observer calls, branch-local observations, workspace-scoped cross-session memory, compaction focus, `/memory` commands with workspace scope, observer usage recording, and `MemorySnapshot`. Workspace recall is a codemode-only query with a scope parameter; the direct session tools keep their names. There is no handoff command, dashboard surface, or global memory store (D194, D199). It does not replace Pi compaction.
- `pi-tasks` and `pi-subagents` share the runtime descendant-group teardown primitive; the task shim records its inner child's process identity so cancel kills both groups (D193, D201).
- `pi-acp` adapter owns JSON-RPC framing, session transport, and client capability requests; the bundled extension owns ACP tools and the socket bridge.
- Dependency direction flows from extensions into shared packages. Host modules remain peer-only.
- Review V19–V38 remediation extracted shared primitives cleanly (D176–D184: `updateJsonConfig`, `sanitizeTerminalText`, group kill, and signal/timeout `withPromptLock`). Round 3 reviews `V39–V61` are recorded in `.artifacts/REVIEWS.md`.

## Dependency Direction

- Dependency direction flows from extensions into shared packages. Host modules remain peer-only.
- Shared packages must not import extension UI or transport code.

## Framework & Library Choices

- Node >= 22.19, npm workspaces, TypeScript loaded by jiti, vitest, and biome.
- Extensions import `@hollowheap/core/*` and `@hollowheap/runtime/*` subpaths instead of the package barrel. Pi reloads each extension through jiti, so a barrel import re-resolves every shared module and costs about 150 ms per extension; `.artifacts/scripts/bench-startup.mjs` measures the full load.
- Pi host modules are peer dependencies; shared runtime packages are real workspace dependencies.
- `packages/pi-acp` builds with `tsc -p packages/pi-acp` into gitignored `dist/`.
- `lang` is a dependency-free LSP client over stdio using Node builtins.
- Codemode uses the host QuickJS surface; web and language tools use it without adding a framework.
- Sandboxing uses system `bwrap`; missing sandbox support fails closed.
- No runtime ACP SDK dependency and no central daemon.
- TUI settings are contributed by loaded extensions through one registration surface; the TUI owns no static catalog of extension-owned settings (D202).
- Dashboard section configuration is an ordered list of entries; position sets display order, absence or `enabled: false` hides a section, and entries carry section-specific options (D206).

## Data & Contracts

- Agent settings live under `<agentDir>` (`permissions.json`, `modes.json`, `hooks.json`, `subagents.json`, `memory.json`, `decide.json`, `language-tools.json`, `modal.json`, `web.json`).
- Trusted project overlays are read only after `ctx.isProjectTrusted()`; untrusted projects are ignored or asked.
- Session state is stored as branch custom entries: mode, cwd (`hollowheap.core.cwd`), usage/budget (`hollowheap.usage`), todos (`hollowheap.todos`), agent (`hollowheap.agent`), autopilot (`hollowheap.autopilot`), guard audit counters (`hollowheap.guard.audit`), hook stats (`hollowheap.hooks`), task/subagent run links (`hollowheap.tasks.run`, `hollowheap.subagents.run`), question answers (`hollowheap.question.answers`), web history (`hollowheap.web.history`), expand preference (`hollowheap.modal.expand`), session-only subagent definitions, and observational memory survive resume and restore from the active branch. `@hollowheap/core/snapshot` (`globalThis[Symbol.for("@hollowheap/core/snapshot")]`) aggregates live state for `pi-dashboard`, and `extractSessionSummaryFromEntries` reads persisted summaries across previous session branches. `maxSessionAgents` and `maxSessionAgentBytes` in `<agentDir>/subagents.json` bound new definitions; `memory.json` controls observer activation, thresholds, redaction, and injection size.
- Permission rules use `allow|ask|deny` with open category tags. Built-in path categories are `read`, `edit`, and `search`; `shell` matches commands; `external` and extension-defined categories match non-path targets such as URLs, queries, and model actions.
- Web search and fetch return normalized shapes with caps; provider keys come only from environment variables.
- Detached processes persist state atomically, stream logs, and speak one JSON object per line over Unix sockets.
- Task records carry id, kind, status, cwd, timestamps, exit code, output, wait, and cancel. Subagent state adds agent, task, PID, start time, socket, session, attempt, and parent session.
- Usage pricing is per message model; USD caps are optional and cache read/write tokens count.
- One core cost function prices every model call: provider `usage.cost.total` when finite and above 0, else the price table. Ledger, statusline, subagent scan, observer, and classifier share it; restore reads the active branch (D178).
- Agent configuration carries the default agent; mode configuration carries the default mode and uses `manual` as the human-authored name. A persisted session mode outranks the configured default (D188, D196, D197).
- Workspace memory entries carry workspace and session origin plus redaction state; they are bounded and append-only, stored under the nearest project-marker directory or repository root, and never merged into a global store (D189, D199). Branch-local observations and their consumed marker remain separate.
- Prompt dialogs stash and restore the exact editor draft; question answers survive backward navigation and are reviewed inline before submission (D187, D190).
- Task and subagent metadata carry inner-process identity so both process groups can be torn down (D193, D201).
- Settings writers update JSON through one core helper that refuses to overwrite an unparseable file and writes temp+rename (D179).

## Operations & Security

- Project trust gates hooks, project agents, language servers, durable tasks, and project config overlays.
- Permission checks apply at the operation boundary, not only in the UI. Unknown tools ask by default.
- Permission precedence, first match wins: hard deny, persistent deny, session deny, most specific allow, trusted root, mode default. Read approval never covers write; `~/` and `@` expand before matching; an unparseable permission file makes gated tools ask (D180, planned).
- Core shell safety owns a destructive-command list that asks in every mode, including autopilot; only an explicit user allow opts out (D181, planned).
- Untrusted text is sanitized of escape and control bytes before rendering; styling is applied afterwards (D182, planned).
- Owned children run in their own process group and are killed by group, TERM then KILL, even after the leader exits; plain-`node` shims inline the same calls (D183, planned). Nested inner groups are torn down through the same runtime path before a cancelled state is written (D201).
- Classifier checks run inside the permission handlers in every mode. An unavailable, timed-out, malformed, or aborted classifier answer leaves the call subject to normal approval and writes an audit note. The payload holds only tool name, tag, and a bounded input summary; a five-second deadline, per-session cache, and per-session call cap bound cost. Classifier traffic cannot re-enter hooks (D186, D198, D200).
- Relative hook commands resolve against the declaring config directory, never the session cwd; malformed `preTool` conditions block (D184, planned).
- `web_fetch` accepts only `http`/`https`, rejects loopback/private/link-local/metadata targets on every redirect, and caps redirects.
- Detached state directories are `0700`; state, log, session, and socket files are `0600`.
- Dead children reconcile through PID plus process start time to avoid PID reuse.
- The process-wide prompt queue serializes blocking dialogs; nested acquisition is forbidden.
- Shell execution uses core policy; extension-run and background commands wrap with `bwrap` and fail closed when required.
- Built-in `bash` and the whole Pi process are outside the extension sandbox; they require an outer container boundary.
- ACP permission requests correlate to the real tool-call id and reject on client reply, disconnect, child exit, or session close.
- No secrets are written to logs or errors; provider keys are never persisted in `web.json`.

## Known Debt

- Review V19–V38 findings are fixed in code and verified against D176–D184 specs S173–S187 (`S173`–`S188`); destructive-shell matching remains heuristic and does not replace an outer sandbox.
- DNS-rebinding hardening for `web_fetch` is deferred.
- Todo dependency/cycle behavior remains unported beyond core CRUD and priority fields.
- Durable task cleanup is manual; there is no automatic task garbage collection.
- Subagents do not auto-resume; `resume` is explicit.
- Generic CLI harness usage is unavailable and excluded from usage totals.
- Custom statusline component loading remains deferred.
- ACP live smoke requires an external client and model, so it is not runnable in-repo.
- The classifier guard is designed but not implemented; its accuracy depends on a bounded input summary rather than full tool input.
- Workspace memory persistence and the inline prompt surface are designed but not implemented.
- Legacy `ask` and `autopilot` mode aliases are scheduled for removal; existing configs using them need a one-time edit.

## Non-Goals

- A ctags or tree-sitter fallback engine in v1; the first version is LSP-only.
- Hover, diagnostics, rename, formatting, or code actions in v1.
- Auto-installing language servers or resolving them from project-local `node_modules`.
- Project-level `language-tools.json`; server commands come from built-in mappings and the agent dir only.
- Semantic or embedding-based code search.
- Direct top-level `question` or `todo` tool schemas; both tools stay `codemode`-only.
- Rewriting stored assistant messages or transcripts when answering questions or mutating todos.
- A persistent split-pane sidebar; Pi overlays and widgets composite above the editor without reflowing the chat transcript.
- A combined tabbed question form; questions are sequential dialogs.
- Removing tagged blocks from RPC client transcripts; RPC rendering is client-owned.
- OS-level sandboxing of allowed shell side effects.
- Standalone `pi-tools` `fd`/`rg` model tools; `acp_fd`/`acp_rg` handle ACP search and core bash handles workspace search.
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
- A theme picker in the statusline; theme ownership stays with the host.
- A memory handoff command, a global memory store shared across workspaces, or a dashboard memory section.
- Todo, agent, grant, or settings actions in dashboard quick actions.
- Legacy `ask` and `autopilot` mode aliases or a rename of the `ask` rule effect.

## Evidence

- Accepted decisions: `.artifacts/DECISIONS.md` D01-D206.
- Requirements: `.artifacts/REQUIREMENTS.md` R01-R107.
- Design intake for this revision: R91 replaced handoff with workspace persistence; D92 superseded by D186; classifier integration research recorded in the design session.
- Behavioral specs: `.artifacts/SPECS.md` (186 entries, S01-S188; S139-S140 absent).
- Historical spec prose: `.artifacts/research/spec-prose-archive.md`.
- Runtime map and commands: `.artifacts/CONTEXT.md`.
- Requirements: `.artifacts/REQUIREMENTS.md`.
- Full build, typecheck, lint (334 files), and test suite (1147 tests/124 files) green on 2026-11-15.

- Overlays that need text input reuse one prompt-draft stash and start in insert mode; navigation-only overlays request normal mode from pi-modal. Todos, tasks, and subagents own separate widget rows; `/widget` replaces `/panel`, and `/grant list` replaces `/grants` (D207–D216).
- Collapse/expand is one tui-owned controller with click-only affordances (`+` expand, `-` collapse). Thinking and tool verbosity are separate low/medium/high settings that override host ctrl+o and ctrl+t; ctrl+shift+o is retired (D216).
