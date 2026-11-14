# Spec Prose Archive

Historical prose moved from `artifacts/specs.md` on 2026-11-02. The executable specification index remains in `artifacts/specs.md`.

## Spec: core runtime foundation (resolved 2026-10-21; supersedes the pi-acp enforcement spec below)

  Decision source: the architectural correction set of 2026-10-21. Implementation: T01-T18 in `artifacts/plan.md`. Supersedes `guard:*` query/command envelopes as the cross-package coordination mechanism.

### 1. Package boundary and loading

  - `@hollowheap/core` gains a runtime entry: `src/index.ts` exports `types.ts` plus `policy.ts`, `config.ts`, `shell.ts`, `exec.ts`, `format.ts`, `state.ts`, `modes.ts`.
  - Core imports no `@earendil-works/*` and no `typebox` (not even as peers); it is dependency-free at runtime.
  - Consumers (pi-guard, pi-tools, pi-budgets, pi-autopilot, pi-acp) list it in `dependencies` at `^0.2.0`, not `devDependencies`. Core moves to `0.2.0` for the breaking API change.
  - pi's loader creates a fresh jiti per extension load with `moduleCache: false` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:477-481`), pi installs package `dependencies` with the source (`docs/packages.md:78`), and installed packages load with separate module roots (`docs/packages.md:92`). One core version can therefore be evaluated more than once per process. All shared state lives on a process-global registry `globalThis[Symbol.for("@hollowheap/core/state")]`, never in module-level variables.
  - `@hollowheap/core` becomes the single documented exception to the no-bare-imports rule (`AGENTS.md:4`); every other bare import stays banned for extension code.

### 2. Permission engine

  ```ts
  export type Tag = "edit" | "read" | "search" | "shell";
  export type Effect = "allow" | "ask" | "deny";        // widened from allow|deny
  export type Verdict = Effect;
  export interface Rule { tag: Tag; pattern: string; effect: Effect }
  ```

  Precedence is a fixed ladder; array order never decides (replaces `extensions/pi-guard/src/rules.ts:83-97`):

  1. **Hard safety invariants → `deny`.** Target outside the realpath'd workspace root; empty shell command; dangerous executables/interpreters (`sh bash zsh dash fish eval xargs env sudo tee dd awk perl python node` and `sh -c`-style wrappers); output/input redirects; command substitution `$(...)`/backticks; process substitution `<(...)`/`>(...)`.
  2. **Explicit `deny` rules** matching the call, from the merged rule set (`<agentDir>/permissions.json` plus a trusted project overlay), beat everything below, including plan-path allowances and mode overrides.
  3. **Active mode overrides** (restrictive rules only, e.g. plan clamping `edit`).
  4. **Merged `allow`/`ask` rules** resolve by highest pattern specificity (literal characters after stripping `*`/`?`); ties favor the stricter effect (`deny > ask > allow`).
  5. **Active mode defaults** for the tag when no rule matched.

  Shell rules match command prefixes on token boundaries: rule `git` matches `git status`, never `github-cli`. Shell chains split on `\n`, `&`, `&&`, `||`, `;`, `|`; every part is analysed independently and the call takes the strictest part result.

### 3. Modes as declarative layers

  ```ts
  export interface ModeLayer {
  name: string;
  defaults: Record<Tag, Effect>;
  overrides?: Rule[];                         // restrictive: ask/deny only
  onEnter?: (owner: unknown) => { veto?: string; notice?: ModeNotice } | undefined;
  }
  ```

  | Layer | read/search | edit | shell | overrides |
  | --- | --- | --- | --- | --- |
  | `ask` (built-in default) | allow | ask | ask | — |
  | `edit` (built-in) | allow | allow | ask | — |
  | `plan` (built-in) | allow | deny | ask | `edit` → ask on `artifacts/plan.md`, `artifacts/specs.md` (effective cwd, D33); `edit` → deny elsewhere |
  | `autopilot` (pi-autopilot) | allow | allow | allow | — (entry gated by pi-budgets) |

  The `ask`/`edit`/`plan` layers live in core; `autopilot` registers at extension load; user layers come from `<agentDir>/modes.json`. Registration is first-wins per name, with a diagnostic on duplicates. Entry runs gates in registration order; the first `veto` blocks the switch and every `notice` surfaces to the user. The procedural `apply` callbacks and `ModeApplyDetails.inPlanPaths` (`packages/core/src/types.ts:11-29`) are deleted.

#### Config-defined layers (`<agentDir>/modes.json`)

  The agent dir comes from `getAgentDir()` (default `~/.pi/agent/`), matching `statusline.json`/`dashboard.json` (`extensions/pi-statusline/src/config.ts:46`, `extensions/pi-dashboard/src/config.ts:4`). Schema:

  ```json
  {
  "modes": {
    "readonly": {
      "defaults": { "read": "allow", "search": "allow", "edit": "deny", "shell": "deny" },
      "overrides": [{ "tag": "edit", "pattern": "docs/**", "effect": "ask" }]
    }
  }
  }
  ```

  - `defaults` must cover all four tags; missing tags are a diagnostic and the layer is dropped.
  - `overrides` accept only `ask`/`deny`; `allow` overrides are a diagnostic and are ignored.
  - Names colliding with built-in or package layers are rejected with a diagnostic (config cannot redefine `ask`/`plan`/`autopilot`).
  - `loadModesConfig(agentDir, onDiagnostic?)` is mtime-cached like `loadPermissions`; diagnostics fire once per change.
  - Config layers carry `source: "config"` and are replaced wholesale on each session start; built-in and package layers persist in the registry. Duplicate config names: first wins, later one diagnosed.

### 4. Session state and registry

  - `session(owner)` returns `{ mode, cwd }`; `setMode`, `effectiveCwd`, `resetSession`, `dropSession` operate on the global registry keyed by the pi session owner. Default mode is `ask`; clearing cwd restores `ctx.cwd`.
  - Persistence: the active mode is appended to the session as `appendCustomEntry("hollowheap.core.mode", { mode })` (`session-manager.d.ts:273`) whenever it changes; `resetSession` re-reads `getEntries()` (custom entries do not enter LLM context) and restores the last known mode, so resume and fork keep it. A restored mode that no longer exists (config removed) falls back to `ask` with a diagnostic, and restored modes re-run entry gates (veto → `ask`). Core takes a structural `SessionLike { getEntries?; appendCustomEntry? }`, never pi types.
  - Modes replace `guard:modes`/`guard:mode-enter` (`extensions/pi-guard/src/index.ts:32-33,109-147`) and cwd replaces `guard:cwd-query`/`guard:cwd-set` (`extensions/pi-tools/src/cwd.ts:1-25`); those channels and their envelopes are deleted.
  - One process holds one ACP session or one TUI session, so a single registry is correct; no cross-process state.

### 5. Shared primitives

  - `runBinary(command, args, cwd, signal, opts?)`: bounded stdout (`maxBuffer`), abort signal, `okExitCodes`, `ENOENT` → `command not found: <name>` after checking cwd existence. Replaces the behaviour in `pi-tools/src/exec.ts`, `pi-acp/src/extension/exec.ts`, `pi-dashboard/src/exec.ts`.
  - `loadPermissions({ agentDir, workspaceRoot, trusted, onDiagnostic? })`: mtime-cached `<agentDir>/permissions.json` plus `.pi/permissions.json` only when `trusted`; parse diagnostics once per change (replaces `pi-guard/src/loader.ts:79-121`). `loadModesConfig(agentDir, onDiagnostic?)` uses the same cache/diagnostic machinery for `<agentDir>/modes.json`.
  - `truncateText(text)` (4000-char threshold, 3000 head + 1000 tail) and `displayTarget(text)` (500-char ellipsis) replace the copies in guard/acp tools.

### 6. Consumer invariants

  - **pi-guard (TUI)**: keeps only the `tool_call` hook (query core for the verdict, prompt via `ctx.ui.confirm` on `ask`, block on `deny`), bash result truncation, `/mode`, `alt+m`, and the `mode-guard` statusline value. Deletes `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts`.
  - **pi-autopilot**: registers the `autopilot` layer; no `guard:modes` listener.
  - **pi-budgets**: registers the autopilot entry gate (no cap → veto, "autopilot refused: set a token cap first"); keeps usage accumulation and the `before_agent_start` cap abort; no `guard:mode-enter` listener.
  - **pi-tools**: `/cd` reads/writes the core session cwd so it works without pi-guard; `fd`/`rg` keep results whose verdict is not `deny` (an `ask` path is not dropped); `fd` args become `["--glob", pattern, "--", dir]`, `rg` passes the pattern via `--regexp` and terminates with `--`. Deletes `rules.ts`, `loader.ts`.
  - **pi-statusline/pi-dashboard**: UI-only; both read `effectiveCwd(ctx.cwd, owner)` for their cwd segment.

### 7. pi-acp protocol, lifecycle, and tools

  - The bundled extension imports `@hollowheap/core`; it deletes `rules.ts`, `loader.ts`, `bash.ts`, `modes.ts`, `exec.ts`, and `decide()`. Its `tool_call` hook evaluates core for the `acp_*` tools (built-ins are disabled, below) and asks the adapter over the socket on `ask`; disconnected → `deny`.
  - Spawn adds `-nbt` (`pi --help` line 36: "Disable built-in tools by default but keep extension/custom tools enabled") so `read/write/edit/bash` cannot run behind the ACP client. `-ne -e <extension>` stays.
  - Lifecycle: `loadSession`/`newSession` close any existing live session (kill child, close server, destroy sockets, unlink path) before spawning, and on any startup-validation failure; prompt completion handlers are registered before dispatching `prompt` (`adapter.ts:795-801` registers after the await today); child exit/error and session close reject all pending prompts, permission requests, and client RPCs; the active mode is pushed to the extension on every connect/reconnect, and mode changes requested before the handshake completes are buffered and applied.
  - Protocol: `session/request_permission` carries the real pi tool-call id (today `acp-${toolSeq}`, `adapter.ts:576-581`); `terminal/output` polling is bounded by a wall-clock timeout in addition to per-request timeouts (`extension/tools.ts:217-241` loops forever); timed-out client RPCs delete their pending entry (outer `withTimeout`, `client-requests.ts:40-56`, leaves the inner entry without a timer).
  - Tools: `acp_write` creates missing parent directories and still refuses existing paths; `acp_edit` keeps the buffer-vs-disk refusal and errors clearly on a missing file; `acp_fd` uses `--glob … --`; `acp_rg` uses `--regexp … --`; `acp_eza` verifies `isDirectory()`; unused helpers that fail `noUnusedLocals` are removed.
  - Approval: `session/request_permission` offers exactly `allow_once`/`reject_once`; deny never reaches the client; no client or disconnect → block with a reason.
  - Mode list: the extension owns the mode registry, so the adapter asks it for the modes (`get-modes` over the socket) and offers every registered mode to the client as a config option. A mode contributed by an extension (`autopilot`) is therefore selectable, and `session/set_config_option` accepts it. The adapter falls back to its built-in `plan`/`ask`/`edit` list when the extension does not answer.
  - Mode notices: a notice produced while entering a mode rides in the returned mode config option's description, so the client renders it without a separate channel. A veto blocks the switch, and the refusal travels as the `set_config` error.

### 8. Non-goals

  OS-level sandboxing of allowed shell side effects; an ACP SDK runtime dependency; sharing state across processes; changing the permission file format beyond the widened effect enum.

### 9. Acceptance

  - `rg -n "function check\\(|globToRegExp|checkBash|loadRules|modeOwners|overrideDirs" packages/*/src` finds implementations only under `packages/core/src`.
  - Mode matrix and precedence ladder covered by table-driven core tests; consumer tests assert delegation, not duplicated policy.
  - Persistence: switching mode then resuming or forking restores it; a removed mode restores to `ask`; a restored `autopilot` without a cap is vetoed back to `ask`.
  - `<agentDir>/modes.json`: a valid custom layer evaluates; a colliding name, an `allow` override, or a missing tag is diagnosed and ignored/dropped.
  - pi-acp tests assert `-nbt` in spawned args, real tool ids in permission requests, and teardown on load failure.
  - `npm test`, `npm run typecheck`, `npm run lint`, `npx tsc -p packages/pi-acp` green; live ACP smoke shows one permission prompt with the client's tool-call id.

## Spec: pi-acp consumes pi-guard enforcement (superseded 2026-10-21 by the core runtime foundation)

  > Historical. Its `guard:tool-tags`/`guard:mode-set` envelopes and the spawn-without-guard fallback are replaced by the section above; do not implement A15-A24.

## Spec: pi-hooks, model-configurable tool hooks (resolved 2026-10-22)

  Decision source: D35-D41. Implementation: T21-T26 in `artifacts/plan.md`. A new `pi-hooks` extension turns a JSON config into pi's existing `tool_call` and `tool_result` events, so the model can install its own pre-tool and post-tool commands.

### 1. Package boundary

  - `extensions/pi-hooks/` is a new `pi.extensions` package: entry `src/index.ts`, declared in the root `package.json` `pi.extensions` list **after** `pi-guard`, so the core policy decides first and pi-hooks only sees calls the policy allowed.
  - It depends on `@hollowheap/core` at `^0.2.0` for the effective cwd (`effectiveCwd`), the active mode (`session`), and `truncateText`.
  - Core gains `runCapture(command, args, cwd, signal, opts?)` in `exec.ts`: optional stdin, and it resolves `{ code, stdout, stderr }` instead of throwing on a non-zero exit. The hook protocol needs the exit code and stderr as values, which `runBinary` discards; adding a second subprocess implementation in a consumer is the duplication D05 forbids.
  - pi-hooks owns its config loader. `hooks.json` has exactly one reader, so a per-instance mtime cache is enough; core's shared globalThis cache exists because `permissions.json` is read by three packages.

### 2. Configuration

  - `<agentDir>/hooks.json` (default `~/.pi/agent/hooks.json`) always. The name does not collide with pi's deprecated `hooks/` directory, which pi warns about (`dist/migrations.js:199-209`).
  - `<project>/.pi/hooks.json` only when `ctx.isProjectTrusted()`; an untrusted project overlay is ignored with a once-per-change diagnostic, and the agent-dir hooks still apply.
  - Both files may appear; project hooks run after the agent-dir hooks.

  ```json
  {
  "hooks": {
    "preTool": [
      { "matcher": "Bash", "command": "check-branch", "args": ["--strict"], "timeoutMs": 5000 }
    ],
    "postTool": [
      { "matcher": "Edit", "command": "npm", "args": ["test", "--silent"] }
    ]
  }
  }
  ```

  - `matcher`: the tool name, matched without regard to case, or a trailing `*` prefix (`"mcp__*"`); omitted or `"*"` matches every tool. A `*` anywhere but the end is a diagnostic.
  - `command`: the program to run. `args`: an optional string array. The command is executed directly, never through a shell, so there is no quoting, glob, or redirection syntax to get wrong.
  - `timeoutMs`: optional, default 10000.
  - A malformed file, an unknown key, a missing `command`, or a bad `matcher` is a diagnostic. The offending hook is ignored and the rest still load; a malformed file yields no hooks at all.

### 3. Execution protocol

  The command runs with the tool call JSON on stdin, in the effective cwd, with the process environment:

  ```json
  { "event": "pre_tool", "toolName": "bash", "toolCallId": "call_1", "input": { "command": "ls" }, "cwd": "/repo", "mode": "ask" }
  ```

  The pre-hook verdict, in order:

  1. stdout parsed as JSON: `{"decision":"block","reason":"..."}` blocks the call, `{"decision":"allow"}` passes it.
  2. empty stdout with exit code 0 passes.
  3. exit code 2 blocks, with stderr as the reason.
  4. any other outcome — a non-zero exit, a timeout, a spawn failure — blocks the call with the failure as the reason (D40).

  A post-hook's stdout is appended to the tool result as a text block, truncated with core's `truncateText`. A post-hook failure is logged and does not change the result: the call already ran, so failing closed is not available.

### 4. Event wiring

  - `tool_call`: the matching pre-hooks run in config order; the first block wins and stops the chain.
  - `tool_result`: the matching post-hooks run in config order; each output is appended.
  - pi-hooks never mutates `event.input` and never replaces result content, only appends (D37, D38).

### 5. The default skill

  - The skill lives at `extensions/pi-hooks/src/skills/hooks-init/SKILL.md` and is contributed with `pi.on("resources_discover", () => ({ skillPaths: [<absolute path>] }))` (D41). It is deliberately not under the package's conventional `skills/` root, so it is never discovered twice.
  - pi advertises a skill by name, description, and path, and the model reads the file itself (`dist/core/skills.js:283-302`). The description is therefore the routing signal and must name hooks explicitly. The model cannot emit `/skill:hooks-init` itself, since that expansion happens only on the user-input path (`dist/core/agent-session.js:1697`).
  - The skill body teaches the file locations, the schema, the verdict protocol, and the trust consequence of writing `hooks.json`.

### 6. Trust and scope

  - The ACP adapter spawns pi with `-ne`, so user extensions are not loaded there and pi-hooks does not affect the ACP path.
  - A project hooks file runs commands only in a trusted project.
  - The model installs hooks by writing `hooks.json` with its own file tools. pi-guard still gates that write: in `ask` mode it asks first, in `edit` and `autopilot` it does not. That is the accepted cost of the skill-only model surface (D39).

### 7. Acceptance

  - `rg -n "execFile|spawn\\(" extensions/pi-hooks/src` finds no subprocess call: the runner is core's.
  - Core tests cover `runCapture` (stdin, exit code, stderr, no throw on a non-zero exit).
  - pi-hooks tests cover config parsing and diagnostics, the matcher, the wiring (a pre-hook blocks, a post-hook appends), the fail-closed path, and that `resources_discover` returns the skill path.
  - The skill's frontmatter is valid and its body states the schema.

## Spec: tool-free question blocks (pending 2026-10-22)

  Decision source: D44-D53. Implementation: pending in `artifacts/plan.md`. The contract replaces the `question` tool with tagged fenced blocks in assistant text and a core-owned scanner that future todo handlers can reuse.

### 1. Package boundary

  - `extensions/pi-question` remains a pi extension, but it registers no model tool. It wires `message_end`, `before_agent_start`, `registerMarkdownTransformer`, and `registerMessageRenderer`.
  - It adds `@hollowheap/core` at `^0.2.0` in `dependencies`. It removes `typebox`, `@earendil-works/pi-ai`, and `@earendil-works/pi-agent-core` from its peer dependencies. It keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.
  - `@hollowheap/core` gains `src/blocks.ts`, exported from `src/index.ts`. Core imports no `@earendil-works/*` and no `typebox`, and adds no runtime dependency.
  - No package version changes in this task (D51). The root `pi.extensions` list still includes `pi-question`.

### 2. Tagged block scanner (core)

  ```ts
  export interface TaggedBlock {
  tag: string;
  body: string;
  start: number;
  end: number;
  closed: boolean;
  }

  export function scanTaggedBlocks(markdown: string): TaggedBlock[];
  ```

  - An opening line is `'''` immediately followed by a tag matching `[a-z][a-z0-9_]*`, with optional trailing spaces. A closing line is `'''` with optional trailing spaces.
  - Blocks may be multiple, empty-bodied, or unclosed at EOF (`closed: false`). `start` and `end` cover the opening line through the closing line, or through EOF when unclosed, so callers can remove the whole block.
  - Lines inside markdown fenced code blocks (` ``` ` or `~~~`) are ignored, so a prose example is not a tagged block.
  - Malformed input never throws.

### 3. Minimal markdown AST (core)

  ```ts
  export type MarkdownNode = HeadingNode | ListNode | ParagraphNode;

  export interface HeadingNode { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  export interface ListNode { type: "list"; ordered: boolean; items: ListItemNode[] }
  export interface ListItemNode { type: "listItem"; text: string; checked?: boolean }
  export interface ParagraphNode { type: "paragraph"; text: string }

  export function parseMarkdownBlocks(body: string): MarkdownNode[];
  ```

  - Headings use `#` through `######`; list markers are `-`, `*`, `+`, or `1.`/`1)`; list items may start with `[ ]` or `[x]`, which sets `checked` to `false` or `true`.
  - A paragraph node groups consecutive non-empty, non-heading, non-list lines, joined with single spaces, without inline-markdown parsing. Nested lists are not required.
  - Malformed input never throws.

### 4. Question block contract

  - A question body uses one H2 per question. H1 and H3+ headings are ignored. A block with no H2 is invalid.
  - Each question reads ordered list items as options; an unordered list inside a question is invalid.
  - If every option starts with `[ ]` or `[x]`, the question is multi-select. If none do, it is single-select. A mix is invalid. `[x]` means "multi marker", not a pre-selected option.
  - A question has 0-8 options. Zero options is a free-text question. Nine or more options is invalid. Empty option text is invalid.
  - The model must not write a write-in option. An option equal to the reserved label `Write-in answer` makes the block invalid; the UI always appends that final row.
  - Multiple H2 questions and multiple `question` fences preserve source order. A block with any invalid question is invalid as a whole.
  - A valid block asks every question sequentially; an invalid block opens no dialogs and remains visible.

### 5. Message hook and lifecycle

  - On `message_end` with an assistant message, inspect its text content blocks and parse every `question` block. Do not treat user or thinking content as questions.
  - If a message contains valid and invalid blocks, ask the valid questions and leave the invalid blocks visible.
  - Ask all valid questions in source order. If any dialog is cancelled, cancel the whole set, send no follow-up, and do not throw.
  - Only a live `message_end` opens dialogs. Resumed or replayed assistant messages are not re-asked; the display transformer still hides valid blocks.
  - The hook never replaces the assistant message. The raw fence remains in agent state, persistence, and model context.

### 6. Dialogs

  - TUI single-select: `ctx.ui.select` with the option labels plus the final `Write-in answer` row. Selecting a normal row records it; selecting the write-in row calls `ctx.ui.input`. The write-in is capped at 500 characters.
  - TUI multi-select: `ctx.ui.custom` renders checkbox rows with the final write-in row. Space toggles a row, entering the write-in row opens an inline editor, and Enter on the Done row submits. Zero selected rows is valid.
  - RPC single-select: the same `select` plus `input` flow as TUI.
  - RPC multi-select: a `ctx.ui.select` loop renders `[ ]`/`[x]` rows plus the write-in row and a Done control. Each call toggles one row or opens `input` for the write-in; Done completes. Zero selected rows is valid.
  - If `ctx.ui.custom` is unavailable, the select-loop is the fallback.
  - A free-text question (zero options) uses `ctx.ui.input` in both modes. An empty string is a valid answer; cancellation cancels the whole set.
  - `ctx.mode === "tui"` selects the custom multi-select component; `ctx.mode === "rpc"` uses the select-loop. Print/json open no dialogs.
  - Questions are sequential; there is no combined tabbed form.

### 7. System prompt section

  - A `before_agent_start` handler adds `event.systemPromptOptions.sections.question_format` only when `ctx.hasUI` is true. The key is stable, and the handler does not return or force a system prompt.
  - The section teaches: the exact `'''question` fence; one H2 per question; ordered-list options; `[ ]` on every option for multi-select; no checkbox for single-select; 0-8 options; the UI supplies the write-in; end the turn without tool calls; answers arrive as a follow-up user message; use questions only when the code or request cannot decide.
  - Print/json get no section, so the model never sees a question contract it cannot answer.

### 8. Display transformer

  - `registerMarkdownTransformer` removes valid `question` blocks only when `context.messageType === "assistant"`.
  - It removes a fully closed valid block, and it removes an open question fence from its opening line through the end of the current markdown while `context.isStreaming` is true to avoid a partial flash.
  - It leaves unknown tags, fully closed invalid question blocks, and non-assistant messages untouched. It ignores markdown fenced code blocks.
  - It never mutates the stored message. RPC clients still receive the raw fence; RPC rendering is client-owned (non-goal).
  - Removing a block may leave the assistant message empty; that is acceptable.

### 9. Answers

  - After all questions are answered, send one `pi.sendMessage` with `customType: "hollowheap.question.answers"`, `display: true`, and `deliverAs: "followUp"`. The host converts the custom message to a user-role message; no tool result is created.
  - `content` lists numbered answers only, in source order, with no question text:
  - single-select: the selected label or write-in text;
  - multi-select: selected labels joined by `, `, with `Write-in: <text>` appended when present, or `none selected` when empty;
  - free text: the input text, or `no answer` when empty.
  - `details` carries `{ questions, answers }` for the renderer.
  - `registerMessageRenderer("hollowheap.question.answers", ...)` renders a compact numbered answer list. It falls back to the content text when details are missing and never throws.
  - Cancellation sends no message.

### 10. Documentation and acceptance

  - `extensions/pi-question/README.md` documents: no tool, the fence syntax, sequential TUI/RPC dialogs, the implicit write-in row, display-only TUI stripping, the RPC raw-fence limitation, silent cancellation, and the breaking removal.
  - Tests cover scanner/AST edge cases, question parsing, TUI single/multi flows, RPC select-loop, system-prompt gating, display stripping, answer delivery, cancellation, and malformed blocks.
  - `npm test`, `npm run typecheck`, and `npm run lint` stay green.

## Spec: pi-acp consumes pi-guard enforcement — body

  Status: resolved 2026-10-19 from pi and anchor sources; ready for implementation. Not implemented.

### Problem

  `packages/pi-acp` re-implements policy that `pi-guard` already owns:

  - `packages/pi-acp/src/extension/rules.ts`, `loader.ts`, `bash.ts` — byte-identical vendored copies of pi-guard's.
  - `packages/pi-acp/src/extension/modes.ts:19-34` — a second `decide()` mirroring pi-guard's `applyPolicy` (`extensions/pi-guard/src/modes.ts:33-46`).
  - `packages/pi-acp/src/extension/index.ts:63,151-207` — its own mode state, `tool_call` gate, and shell gate.
  - `packages/pi-acp/src/adapter.ts:28-29,145-172,545` — a hardcoded `MODES` list and `set_config` validation.

  Drift is guaranteed: the two policy copies must be hand-synced, and already diverge structurally (`applyPolicy` is rule-driven; `decide` is a hand-written table).

### Goal

  pi-acp owns only two things: (1) fallbacks when pi-guard is absent, and (2) making ACP work over `pi --mode rpc`. All rule, mode, and permission decisions come from pi-guard loaded in the same pi process.

### Non-goals

  - Not changing pi-guard's policy semantics (see `extensions/pi-guard/README.md` outcome matrix).
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
  - pi-guard's `requestApproval` (`extensions/pi-guard/src/index.ts:66-88`) calls `ctx.ui.confirm`, which rpc-mode surfaces as the request above (`.../rpc-mode.js:85`).

  Contract: the adapter answers every `method: "confirm"` request by calling ACP `session/request_permission` with exactly `allow_once`/`reject_once`, then replies `confirmed: true` for allow and `confirmed: false` for reject. With no client connected, reply `cancelled: true` (fail closed). No other `extension_ui_request` method is answered by policy; `notify`/`setStatus` etc. map to ACP where a client capability exists and are dropped otherwise.

### Interface contract: mode list

  The adapter needs the mode list for `SessionConfigOption category "mode"` (`adapter.ts:145-172`). Contract:

  - pi-guard's existing `guard:modes` query (emitted every `session_start`, `extensions/pi-guard/src/index.ts`) is the source of truth.
  - The bundled extension subscribes to `guard:modes`, forwards `{ modes }` to the adapter over the socket, and the adapter builds config options from names + descriptions.
  - Fallback: if no `guard:modes` contributor answers within the session-start window, the extension forwards the built-in `plan`/`ask`/`edit` list itself. This is the "define fallbacks" obligation.

### Interface contract: mode set

  rpc has no generic slash-command invocation (`rpc-types.d.ts:14-140`), so ACP `set_config` cannot drive pi-guard's `/mode`. Contract:

  - pi-guard gains a `guard:mode-set { mode, owner? }` command envelope applied through its existing `switchMode` path (`extensions/pi-guard/src/index.ts:124-147`), so the `guard:mode-enter` veto/notice still runs.
  - The bundled extension, on adapter `set_config`, emits `guard:mode-set`; without pi-guard it falls back to its local default list.
  - Scoping (resolved): `switchMode` needs an `ExtensionContext` for `ctx.ui.notify` and `ctx.sessionManager`. pi-guard already sees one on every `session_start` (`index.ts:230-235`); it stores it as the active context and the envelope handler applies only when `owner === undefined || owner === activeCtx.sessionManager`, ignoring stale owners. The notice surfaces to ACP as `extension_ui_request{method:"notify"}` (`rpc-types.d.ts:436`) which the adapter may drop.

### Interface contract: acp_* tool tagging

  pi-guard's `TOOL_TAGS` (`extensions/pi-guard/src/index.ts:37`) covers built-ins only, so `acp_read/acp_write/acp_edit/acp_bash/acp_fd/acp_rg/acp_eza` currently fall to the unknown-tool ask. Contract (resolved):

  1. `guard:tool-tags` query (chosen): extensions register `{ name -> tag }` contributions; pi-guard composes its map at session start (`index.ts:163-164` consumes it synchronously per call) exactly like the existing `guard:modes` query (`index.ts:109-113`). Keeps policy single-owned and extensible; the bundled extension contributes `acp_read -> read`, `acp_fd/acp_rg/acp_eza -> search`, `acp_write/acp_edit -> edit`, `acp_bash -> shell`. Rejected: 2 (drop `acp_*` tools, losing client `fs`/`terminal` routing) and 3 (wrap built-ins, which cannot survive the hook running before execute).

### Interface contracts: data shapes

  All envelope contributions are synchronous in-place mutations, matching `guard:modes` (`extensions/pi-guard/src/index.ts:109-113`); the emitter owns the object and reads it back immediately.

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

## Spec: tool-free todos (pending 2026-10-22)

  Decision source: D54-D60. A new `pi-todos` extension owns tagged todo blocks, branch-local session state, `/todos`, the compact widget, and the status count; it registers no model tool. Core remains the scanner/AST owner.

### 1. Package boundary

  - `extensions/pi-todos/src/index.ts` is the extension entry; its `package.json` declares the pi extension and the root `pi.extensions` list adds `./extensions/pi-todos/index.ts`.
  - It depends on `@hollowheap/core` at `^0.2.0` and keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer dependencies. It has no `typebox`, `pi-ai`, or `pi-agent-core` dependency and registers no model tool.
  - The version stays `0.2.0`; no coordinated release is part of this task.
  - Core gains no code beyond the existing `scanTaggedBlocks`/`parseMarkdownBlocks` seam.

### 2. Block format

  ```text
  '''create_todos
  1. Write the parser tests
  2. Update the README
  '''

  '''complete_todos
  1. 2
  '''
  ```

  - `create_todos` has exactly one ordered list. Every item text is a non-empty task, after trimming. Checkbox markers (`[ ]`/`[x]`) are not part of the format and make the block invalid. At least one item is required.
  - `complete_todos` has exactly one ordered list. Every item text is a positive decimal ID (`1`, `2`, ...); leading zeros and non-numeric text are invalid. At least one ID is required. Duplicate IDs are applied once.
  - A block with any other node, an empty list, an unordered list, or malformed text is invalid as a whole.
  - Multiple todo blocks in one assistant message are processed in source order. Only fully closed blocks are handled.

### 3. State

  - The state shape is `{ todos: { id: number; text: string; done: boolean }[]; nextId: number }`.
  - State is branch-local: on `session_start` and `session_tree`, clear the in-memory state and reconstruct it by scanning `ctx.sessionManager.getBranch()` for the latest `entry.type === "custom"` with `customType === "hollowheap.todos"`; use `entry.data`.
  - A valid `create_todos` appends tasks in list order and assigns monotonic numeric IDs from `nextId`. It never replaces or deletes existing todos.
  - A valid `complete_todos` marks matching IDs done. Unknown IDs are ignored and reported; they never throw.
  - After one assistant message is fully processed, append one `hollowheap.todos` custom entry only when the state changed. Do not append one entry per block.
  - IDs are never reused. Completed todos remain in the list with `done: true`.

### 4. Confirmation message

  - After at least one valid todo block, send one custom follow-up:
  `pi.sendMessage({ customType: "hollowheap.todos.updated", content, display: true, details: { todos, unknownIds } }, { deliverAs: "followUp" })`.
  - `content` lists every todo as `#<id> [ ] <text>` or `#<id> [x] <text>`, in ID order. Append `Unknown IDs: <comma-separated>` when a valid completion named IDs that were not found. The content is the model-visible confirmation that lets it learn assigned IDs.
  - Register a renderer for `hollowheap.todos.updated` that renders the numbered list and falls back to `content` when details are missing; it never throws.
  - No confirmation is sent for an invalid block that changed nothing.

### 5. `/todos`, widget, and status

  - `/todos` lists every todo in ID order with `#<id>`, a done marker, and the text. TUI uses a closeable custom list component; RPC uses `ctx.ui.notify` with the same text. Print/json never open a dialog.
  - `ctx.ui.setStatus("todos", text)` shows `open/total` after every state change and after restore. When the list is empty, call `setStatus("todos", undefined)`.
  - `ctx.ui.setWidget("todos", lines)` shows up to five open todos above the editor as `#<id> <text>`, under a `Todos (<n> open)` header. When more open todos remain, append `+<n> more (/todos)`. Omit completed todos. Clear the widget with `undefined` when no open todos remain. Restore and every state change update it.
  - RPC receives the same string-array widget through the extension UI protocol. Print/json set neither status nor widget.

### 6. Prompt and gating

  - A `before_agent_start` handler adds `event.systemPromptOptions.sections.todos_format` only when `ctx.hasUI` is true. The key is stable, and the handler does not return or force a system prompt.
  - The section teaches: the exact `'''create_todos` and `'''complete_todos` fences; ordered-list task texts; no checkboxes in `create_todos`; numeric IDs in `complete_todos`; append semantics; one follow-up confirmation with IDs; `/todos`; and no model tool.
  - Print/json get no section.

### 7. Message hook and display transformer

  - On `message_end` with an assistant message and `ctx.hasUI`, parse text content blocks for closed `create_todos`/`complete_todos` blocks. Ignore user/thinking content, unknown tags, invalid blocks, and unclosed blocks. Never replace the assistant message.
  - A live message is handled once; resumed or replayed messages are not re-asked. Malformed input never crashes.
  - `registerMarkdownTransformer` removes valid closed todo blocks only from assistant TUI markdown. It removes an open todo fence from its opening line through the current end while `context.isStreaming` is true. Unknown tags, fully closed invalid blocks, non-assistant messages, and markdown code fences stay untouched.
  - The stored message and model context keep the raw fence; RPC clients still receive it.

### 8. Tests and docs

  - `extensions/pi-todos/src/todos.test.ts` covers create/complete parsing, append and IDs, completion, unknown IDs, invalid/mixed blocks, the confirmation text, and widget formatting/capping.
  - `extensions/pi-todos/src/index.test.ts` covers the message hook, branch restore/persist, status count and widget updates, confirmation message/renderer, prompt gating, display stripping, `/todos`, duplicate-message handling, and malformed input.
  - `extensions/pi-todos/README.md` documents the format, no-tool flow, session state, the compact widget, `/todos`, status count, TUI-only stripping, RPC raw-fence limitation, and print/json gating.
  - Root `package.json`, workspace lock, typecheck, tests, and lint are consistent.

## Spec: code intelligence (pending 2026-10-23)

  Decision source: D61-D64. A new `pi-language-tools` extension owns LSP-backed, read-only navigation and registers one `lang` codemode tool. It adds no UI, command, or other model tool; core stays host-free and `pi-tools` stays stateless.

### 1. Package boundary

  - `extensions/pi-language-tools/src/index.ts` is the extension entry. Its `package.json` declares it as a pi extension, lists `@hollowheap/core` at `^0.2.0` in `dependencies`, and keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` as peers. It has no `typebox` or `pi-agent-core` dependency.
  - The root `package.json` `pi.extensions` list includes `./extensions/pi-language-tools/index.ts`. The version stays `0.2.0`.
  - The extension registers exactly one tool, `lang`, with `exposure: "codemode"`, and activates codemode on `session_start` when the host exposes it and it is not already active.
  - It owns server processes, configuration, and cleanup. Core gains no LSP or process code.

### 2. Tool contract

  ```ts
  lang({
  action: "definition" | "references" | "document_symbols" |
          "workspace_symbols" | "hover" | "signature_help" |
          "type_definition" | "implementation" |
          "document_highlights" | "diagnostics",
  path: string,        // required; selects the language server
  line?: number,       // 1-based; position actions
  column?: number,     // 1-based; position actions
  query?: string,      // required for workspace_symbols
  max_results?: number // core clamp: default 100, max 500
  })
  ```

  - `path` is required for every action and resolves against the effective cwd (`effectiveCwd(ctx.cwd, ctx.sessionManager)`); it must be inside `ctx.cwd` under core path rules. For `workspace_symbols`, the path selects which language server answers the workspace-wide query.
  - Input positions are 1-based editor coordinates. The client converts them to 0-based LSP `line`/`character`.
  - `definition`, `references`, `type_definition`, and `implementation` return one `path:line:column` per location, where line/column are 1-based and path is relative to the effective cwd.
  - `document_symbols` returns an indented outline, `name (kind) path:line`, with child symbols indented two spaces per depth.
  - `workspace_symbols` returns `path:line:column name (kind) [container]`.
  - `hover` returns hover text. `signature_help` returns the active signature, active parameter, and documentation. `document_highlights` returns `path:line:column read|write|text`.
  - `diagnostics` returns `path:line:column severity source: message [code]`; it uses pull diagnostics when the server advertises `diagnosticProvider`, otherwise waits for push diagnostics after a full document sync.
  - Empty results return the matching `No ... found.` text.
  - Results are capped by `max_results`; when more are available, append `... (truncated)`.
  - Validation errors, denied paths, untrusted projects, missing servers, timeouts, and server failures return explanatory text. They never throw and never return partial mutation state.

### 3. LSP transport and lifecycle

  - The client uses only Node builtins. It spawns the configured command with `args`, `cwd: ctx.cwd`, `stdio: ["pipe", "pipe", "pipe"]`, and the inherited environment. It never uses a shell.
  - JSON-RPC messages are framed with `Content-Length` in UTF-8 bytes. The parser handles partial headers, partial bodies, and multiple messages in one chunk; header names are case-insensitive.
  - The client sends `initialize` with `processId`, `rootUri` for `ctx.cwd`, workspace-folder metadata, and capabilities for definition (including link support), references, hierarchical document symbols, workspace symbols, hover, signature help, type definition, implementation, highlights, and pull diagnostics. It sends `initialized` before queries.
  - One server is pooled per `command + args + root`. Servers start lazily on the first query and are reused. Requests and document synchronization are serialized per server. The pool lives on a process-global symbol so a jiti reload can dispose the previous instance's servers.
  - The server may send requests (`workspace/configuration`, capability registration, progress creation) and notifications. The client answers known setup requests with `null`/empty configuration, resolves `textDocument/publishDiagnostics` waiters, ignores progress, and answers unknown requests with `null`. It never crashes on server traffic.
  - Before a position or document-symbol query, the client reads the file from disk. On first use it sends `textDocument/didOpen` with the server's language id, version `1`, and the disk text. When the disk text changed, or diagnostics force a refresh, it sends a full-text `textDocument/didChange` with the next version. Missing or non-file targets return text.
  - The default request timeout is 10 seconds; per-server `timeoutMs` may lower or raise it up to 60 seconds. A request timeout rejects only that request and sends `$/cancelRequest`; an initialization or protocol failure kills that server, rejects pending requests, and removes it from the pool; the next query may respawn it.
  - Server stderr is captured in a bounded buffer for error text and is not printed. Server exit rejects pending requests and removes the pool entry.
  - `session_start` disposes stale servers before restoring anything. `session_shutdown` disposes all servers, sending `shutdown`/`exit` and then killing the child. Cleanup is best-effort and never blocks the session.

### 4. Configuration and trust

  - Built-in mappings cover TypeScript/JavaScript (`typescript-language-server --stdio`), Python (`pyright-langserver --stdio`), Rust (`rust-analyzer`), Go (`gopls`), C/C++ (`clangd`), and Lua (`lua-language-server`).
  - Built-ins use extension maps so TypeScript and JavaScript get distinct language ids (`.ts` -> `typescript`, `.tsx` -> `typescriptreact`, `.js` -> `javascript`, `.jsx` -> `javascriptreact`).
  - `<agentDir>/language-tools.json` overlays built-ins by server name and adds new servers:

  ```json
  {
  "servers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": { ".ts": "typescript", ".tsx": "typescriptreact" },
      "timeoutMs": 10000
    }
  }
  }
  ```

  - `command` is a non-empty string, `args` is a string array, `extensions` is a non-empty suffix-to-language-id map, and `timeoutMs` is a positive integer. Invalid entries are dropped with one `ctx.ui.notify` diagnostic per file change. A user entry replaces the built-in of the same name.
  - User servers are matched before built-ins; the first server claiming the file suffix wins. A duplicate suffix across user servers is diagnosed and the later one is ignored.
  - No project-level config is read. No server is auto-installed or resolved from `node_modules`.
  - The tool requires `ctx.isProjectTrusted()` before spawning or reusing a server. In an untrusted project it returns a trust-gate message and starts nothing. The server runs with the user's permissions and can read more than the tool returns; trust gating plus result filtering is the boundary.

### 5. Permissions and formatting

  - Permissions come from core `loadPermissions` with `getAgentDir()`, `ctx.cwd`, and `ctx.isProjectTrusted()`, cached through core.
  - The input path and every returned location are checked with `checkPath(rules, abs, "read", ctx.cwd)`. A `deny` drops the location; `ask` is treated as allowed, matching `pi-tools`.
  - Display paths use `displayPath(effectiveCwd, absolute)` and forward slashes. Workspace symbols outside the workspace are dropped.
  - Kind formatting maps LSP `SymbolKind` numbers to lower-case names (`function`, `method`, `class`, ...). Unknown kinds render as `symbol`.
  - Highlight kinds map to `read`, `write`, or `text`. Diagnostic severities map to `error`, `warning`, `info`, `hint`, or `diagnostic`.
  - Output is plain text in the tool content; `details` carries `action`, `path`, `count`, and `truncated` for codemode scripts.

### 6. Tests and docs

  - `src/lsp.test.ts` covers framing (partial/multiple messages), response routing, timeouts, server crash, stderr capture, didOpen/didChange versions, server pooling, and cleanup. A fixture Node script speaks the minimal protocol; no real language server is required.
  - `src/config.test.ts` covers built-in lookup, overlay by name, extension precedence, invalid entries, mtime diagnostics, and missing commands.
  - `src/tool.test.ts` covers action validation, 1-based conversion, definition/reference/symbol formatting, caps, empty results, trust gating, path denial, missing server, timeout text, and no throws.
  - `src/index.test.ts` covers tool registration/exposure, codemode activation, session cleanup, and that no UI, command, or second tool is registered.
  - `extensions/pi-language-tools/README.md` documents actions, 1-based positions, built-ins, the config schema, trust gating, no auto-install, codemode exposure, timeout behavior, and the read-only scope.
  - Root manifest, workspace lock, typecheck, full tests, and lint are consistent.

## Spec: background tasks (pending 2026-10-25)

  Decision source: D65-D72. Implementation: pending in `artifacts/plan.md`. A new `extensions/pi-tasks` extension owns durable shell task lifecycle, the generic task registry, and the direct `task` tool (`start`, `list`, `status`, `wait`, `cancel`) while leaving the host built-in `bash` tool untouched. `pi-tools` stays stateless and `@hollowheap/core` gains no process or host code.

### 1. Package boundary and ACP scope

  - `extensions/pi-tasks/src/index.ts` is the extension entry. Its `package.json` declares it as a pi extension, lists `@hollowheap/core` at `^0.2.0` in `dependencies`, and keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peers. It has no `typebox` dependency.
  - The root `package.json` `pi.extensions` list includes `./extensions/pi-tasks/index.ts`. The version stays `0.2.0`.
  - `task` is registered as a direct tool (`exposure` omitted). Built-in `bash` is not overridden, and no `/background` command or shortcut is registered. `lang` remains `exposure: "codemode"`.
  - ACP spawns pi with `-ne -e <bundled-extension> -nbt`, so `pi-tasks` is not loaded in ACP sessions and `acp_bash` remains the sole shell path over the client terminal. If `pi-tasks` is ever loaded in an environment where `PI_ACP` is active, it stays inert.

### 2. Generic task record and durable storage

  ```ts
  export type TaskKind = "shell" | "subagent";
  export type TaskStatus = "running" | "completed" | "failed" | "cancelled";

  export interface TaskRecord {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  command?: string;
  cwd: string;
  pid?: number;
  startTime?: number;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  output: () => Promise<string>;
  wait: (timeoutMs?: number, signal?: AbortSignal) => Promise<TaskRecord>;
  cancel: () => Promise<TaskRecord>;
  }
  ```

  - v1 implements `kind: "shell"`. `inbox`/`outbox` are deferred until the subagent RPC spec (D70, D71).
  - Durable shell tasks store metadata in `<agentDir>/tasks/<id>.json` (`0600`) and combined stdout/stderr in `<agentDir>/tasks/<id>.log` (`0600`), inside `<agentDir>/tasks/` (`0700`).
  - Durable tasks are spawned through a detached Node runner shim (`process.execPath -e ...`, `detached: true`, `stdio: "ignore"`, `unref()`) so the shell child is always spawned under a process group owned by the shim. When the command exits, the shim atomically updates `<id>.json` with `status` (`"completed"` for exit 0, `"failed"` otherwise), `exitCode`, and `finishedAt`.
  - To prevent OS PID-reuse false positives across sessions, `<id>.json` records the shim/child `pid` and OS process `startTime` (e.g., `/proc/<pid>/stat` field 22 on Linux). When `list`, `status`, or `wait` inspects a `"running"` task whose `pid` is dead or whose live process `startTime` does not match, it reconciles the record to `status: "failed"`, `exitCode: null`, `finishedAt: Date.now()`.
  - `session_shutdown` leaves durable tasks running; cleanup of `<agentDir>/tasks/` is manual in v1.

### 3. `pi-guard` and `pi-hooks` integration

  - In `extensions/pi-guard`, `task` is handled in `tool_call`:
  - When `action` is `"list"`, `"status"`, `"wait"`, or `"cancel"`, `pi-guard` returns `undefined` (allowed without prompting), because those actions inspect or stop existing tasks in `<agentDir>/tasks/`.
  - Otherwise (including `action === "start"`), `pi-guard` evaluates `command` under `tag: "shell"` in `ctx.cwd` using core `evaluate()`, blocking on `"deny"` and prompting via `ctx.ui.confirm("Allow task?", displayTarget(command))` on `"ask"`.
  - In `extensions/pi-Tasks`, `task` (`action: "start"`) also checks core `evaluate()` (`tag: "shell"`) as defense-in-depth when `pi-guard` is not loaded, blocking on `"deny"` and requiring `ctx.isProjectTrusted()` before spawning.
  - `pi-hooks` automatically receives `pre_tool` and `post_tool` events for `toolName: "task"`.

### 4. `task` tool contract

  ```ts
  task({
  action: "start" | "list" | "status" | "wait" | "cancel",
  command?: string,   // required for start
  id?: string,        // required for status, wait, cancel
  timeoutMs?: number  // optional for wait (default 30000, max 600000)
  })
  ```

  - `start`: requires `ctx.isProjectTrusted()` and a non-empty `command`. Resolves working directory via core `effectiveCwd(ctx.cwd, ctx.sessionManager)`. Spawns the detached runner shim and returns immediately with task `id`, `pid`, and log path.
  - `list`: reconciles all task records in `<agentDir>/tasks/` and returns a summary table (`id`, `kind`, `status`, `exitCode`, `startedAt`, `command`).
  - `status`: reconciles task `id` and returns its metadata plus the current log output truncated with core `truncateText`.
  - `wait`: if task `id` is already terminal, returns its status and truncated output immediately. Otherwise watches/polls `<id>.json` (and reconciles liveness) until the task exits, `timeoutMs` elapses, or `signal` aborts, then returns the updated status and truncated output. Completion never triggers an unsolicited model turn.
  - `cancel`: verifies `pid` + `startTime` liveness, sends `SIGTERM` (followed by `SIGKILL` grace timeout) to the process group, updates `<id>.json` to `status: "cancelled"` with `finishedAt`, and returns the updated state.
  - Unknown `id` or invalid parameters return explanatory text without throwing.
  - Statusline integration: `ctx.ui.setStatus("tasks", "<n> running")` when `n > 0`, cleared with `undefined` when `0`.

## Removed index wrapper headings

- `## Spec: tool exposure (historical)`
- `## Spec: web tools`
- `## Spec: classifier`
- `## Spec: workspace enhancements`
