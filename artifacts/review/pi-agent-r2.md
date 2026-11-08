# Review — pi-agent re-review (V32)

## Scope

- Slice: `extensions/pi-agent/src/{index,agents,picker,popup}.ts` (858 LOC incl. tests read; 22 tests in 4 files pass: `npx vitest run extensions/pi-agent`).
- Commit: `a035b03` (HEAD). Recent slice commits: `5807672` (restore captured default tool set), `cec13a3`, `978083a`.
- Lenses: robustness, UI, backend, performance, simplicity.
- Prior reviews: `artifacts/review/pi-agent.md` (V01, Resolution lines at lines 39-44 and the overengineering table) and `artifacts/review/ui-upgrades.md` (V17; its pi-agent mentions are at lines 54, 60, 83-84, 123; no pi-agent Resolution lines).
- Host read: `node_modules/@earendil-works/pi-coding-agent` 1.4.0: `dist/core/agent-session.js` (1011-1024, 1087-1162, 1389-1412, 2008-2016, 2799-2803, 2870-2952, 2963-3020, 3405), `dist/core/agent-session-runtime.js` (102-127, 174-236), `dist/core/extensions/loader.js` (115-119, 197-201, 317-347), `dist/core/extensions/runner.js` (110-118), `dist/core/extensions/types.d.ts` (393-496, 1282-1305), `node_modules/@earendil-works/pi-tui/dist/terminal.js` (473-476).
- Probes: out-of-tree in `/tmp/pi-agent-r2` (fake host that mirrors `setActiveTools` filtering and the stale-API rule). Deleted after the run. Repo files were not edited.
- Shared packages (V20 `packages/tui`, V22 `packages/core`): only slice usage is noted (F-lock below and `enterMode` at `index.ts:105`).

## Prior resolutions

V01 Resolution lines (`artifacts/review/pi-agent.md:39-44`):

- Fork results checked via `forkStarted`; no double-apply: holds, `index.ts:206-239`. The post-fork path itself is broken (F2).
- Persisted-name restoration clears only on explicit `null`: holds, `index.ts:256-262`.
- Model matching avoids unsafe cast, no notify without `getAll`: holds, `index.ts:112`. Narrowing casts remain at `index.ts:28, 120` (from `unknown`, not `as unknown as`).
- Empty `agent.tools` no longer disables all tools: holds, `index.ts:149-156`.
- Completion context refreshed from `before_agent_start`: holds, `index.ts:295-299`.
- Project-agent discovery resolves cwd and guards stats: holds, `agents.ts:137-152`.
- Per-file discovery failures reported as diagnostics: holds, `agents.ts:78-92, 128-131`. Shadowed duplicates are not reported (F6).
- Popup width handles empty content: holds, `popup.ts:40-46` via `frame.ts:14-33`.

V01 overengineering table (`pi-agent.md:70-74`):

- `AgentExtensionDeps` and duplicate wrappers removed: holds, `index.ts:41`.
- `model.ts` folded into `index.ts`: holds, `index.ts:25-39`.
- `AgentScope` option removed: holds, `agents.ts:5-28`.

V17 pi-agent claims: picker with preview (`ui-upgrades.md:54`), `/agent` autocomplete (`:60`), and fuzzy palette with preview (`:83-84`): hold, `picker.ts:76-119`, `index.ts:320-338`.

Commit claim `5807672` ("restore the captured default tool set"): regressed. It holds for the same-runtime default after one agent switch. It fails after reload or resume (F1) and on switch-back after the tool set changed (F4). Verified across the a035b03 codemode fix: `index.ts:55-65` drops `codemode-only`, `hidden`, and `deferred` exposures. `pi-web/src/tools.ts:282, 414` and `pi-language-tools/src/tool.ts:618` declare `exposure: "codemode"`, so the filter removes them. Holds.

Regressed V01/V17 Resolution lines: 0 of 8 (V01) and 0 of 0 (V17). Regressed commit claims: 1 (`5807672`).

## Findings

F1 — high — Robustness
- Current: `index.ts:48-54` captures `pi.getActiveTools()` only once and only if unset; `index.ts:284-287` calls it at `session_start`.
- Gap: at `session_start` the live set already holds the restricted set. Reload keeps it (`agent-session.js:2999-3019`: `getActiveToolNames()` is passed as `activeToolNames`). Startup or resume re-applies the transcript loadout before the event (`agent-session.js:214`, `:1389-1412`). The restored agent's `tools` are then captured as the "default".
- Failure: after `/reload` (or resuming a session in which `reviewer` was active), `/agent default` keeps only `read`. `bash`, `edit`, `write` stay disabled for the rest of the session.
- Reproduction: fake host with registered `read,bash,edit,write`, live `["read"]`, branch entry `{customType:"hollowheap.agent", data:{name:"reviewer"}}`, `reviewer.md` has `tools: read`. Fire `session_start` (reason `reload` or `resume`), then `/agent default`. Result `live = ["read"]`. Probe S1.
- Fix: stop snapshotting the live set. Derive the default from `pi.getSettings().defaultTools` or from `getAllTools()` (exposure `direct`/`model-only`, `defaultActive !== false`) at switch time, not from the session-start live set.
- Confidence: high for reload (code path and probe S1). Resume follows from `agent-session.js:214` and `:1389`; UNVERIFIED against a live resumed session.

F2 — high — Robustness
- Current: `index.ts:212` `pi.setSessionName`, `:214` `pi.setLabel`, `:216` `applyAgent(agent, forkCtx, pi, …)` (uses `pi.appendEntry`, `pi.setActiveTools`), `:220` popup, all inside `withSession` using the outer `pi`.
- Gap: `ctx.fork` tears down the old session first (`agent-session-runtime.js:206/224/235` → `teardownCurrent` `:102-110`), which calls `session.dispose()` → `_extensionRunner.invalidate()` (`agent-session.js:1022`). The old extension API then throws (`loader.js:115-119`, `:197-201`). The host says to use the ctx passed to `withSession` (`runner.js:482`).
- Failure: `/agent <name>` on a branch with history forks and then fails. The forked session gets no agent status, mode, tools, model, thinking, label, name, or popup. The user sees `Agent switch failed after fork: Extension runtime is stale`.
- Reproduction: fake `ctx.fork` that sets `stale=true` (makes the captured `pi` methods throw) and then calls `withSession(forkCtx)`; branch has a user message; run `/agent reviewer`. Notes: `error: Agent switch failed after fork: Extension runtime is stale`; no agent applied. Probe7.
- Fix: do post-fork work through the new session's API only. Persist the choice in the forked session before `withSession` (through a context method, if one exists, UNVERIFIED which `ReplacedSessionContext` methods are safe), and let the new `session_start` (reason `fork`) call `restore()`. Minimal alternative: stop using `pi` inside `withSession`.
- Confidence: high on the failure path (code path and probe7). Reproduced live by the user: `Failed to fork session: This extension ctx is stale after session replacement or reload`.
- Resolution: `switchAndFork` stores the pending agent in a `globalThis` slot before `ctx.fork`. The replacement instance applies it from `session_start` (reason `fork`) with its own `pi`. `withSession` only shows the popup through the replaced ctx. A failure after replacement rethrows instead of an in-place switch on the stale `pi`. Test: `extensions/pi-agent/src/index.test.ts` (stale old `pi` during fork).

F3 — medium — Robustness
- Current: `index.ts:112-147` sets model and thinking for an agent; `index.ts:163-186` `applyDefault` restores only tools (`:181`). Nothing captures model or thinking.
- Gap: "exact restore of model and thinking on switch-back" is not implemented. An agent with no `model` or `thinking` inherits the previous agent's values.
- Failure: `fast` (thinking `high`, model `m1`) → `/agent default` leaves thinking `high` and model `m1`.
- Reproduction: probe S4 (`thinking: high` and `model: m1` are still set after `default`).
- Fix: snapshot `pi.getThinkingLevel()` and the current model with the tool snapshot. Restore both in `applyDefault`.
- Confidence: high.

F4 — medium — Robustness
- Current: `index.ts:49-54` snapshots once per runtime and never refreshes it. `applyDefault` replays that snapshot (`:181`).
- Gap: any change after startup is lost on switch-back. A tool registered later is dropped. A tool the user turned off with `/tools` comes back. Host: `setActiveToolsByName` clears pending tools when a previously active tool is removed (`agent-session.js:1119-1126`).
- Failure: (a) late tool `lsp_hover` added to the live set, then `/agent reviewer` then `/agent default` → `lsp_hover` gone (probe S2). (b) user disables `bash`, then the same round trip → `bash` re-enabled (probe S3).
- Fix: when no agent is active, snapshot the live set at the moment of the first switch away from default (`if (!activeAgent) baseActiveTools = currentDefault()`), not at session start. Keep the exposure filter.
- Confidence: high (probes S2, S3). Overlaps F1; fixing F1 alone does not fix this.

F5 — medium — Robustness
- Current: `index.ts:188-208` runs `ctx.fork` with no idle check, and `index.ts:245` and `:378` set tools and model with no check.
- Gap: `runtime.fork` → `teardownCurrent` → `session.abort()` (`agent-session-runtime.js:102-105`). Switching with history while a turn streams aborts that turn with no warning. In-place switches change tools and model for the next request in the running turn (`agent-session.js` `_preparePromptAndToolLoadout`, per request).
- Failure: a streaming answer is aborted when the user runs `/agent x`. Commands dispatched during streaming are UNVERIFIED for the TUI.
- Fix: `if (!ctx.isIdle()) { notify("wait for the turn to finish", "warning"); return; }`, or `await ctx.waitForIdle()` before fork.
- Confidence: medium (code path only).

F6 — medium — Backend
- Current: `agents.ts:161-176` `agents.set(agent.name, agent)` for each file, then user then project.
- Gap: two files with the same `name` in one directory, or a project agent overriding a user agent, drop one entry with no diagnostic.
- Failure: `a.md` and `b.md` both `name: review` → `review|second` only. The first file vanishes from `/agent` and no warning is shown. Probe S5.
- Fix: report `duplicate agent "review": <path> shadowed by <path>` in `diagnostics` when `agents.has(name)` and the source is the same directory; keep the project override with a note.
- Confidence: high.

F7 — medium — Backend (dead config)
- Current: `index.ts:354-357` treats `default` and `reset` as reserved in the command argument; `index.ts:373-376` and `picker.ts:40` use the value `"default"` for the reset option.
- Gap: an agent named `default` is listed (`agents.ts` accepts it) but can never be selected.
- Failure: `default.md` with `name: default` is discovered (probe S5) but `/agent default` always resets. Its description is dead config.
- Fix: reject reserved names with a diagnostic in `agents.ts:loadDirectory`, e.g. `"default" is reserved`.
- Confidence: high.

F8 — medium — Robustness (UNVERIFIED runtime count)
- Current: `index.ts:112-123` calls `piApi.setModel(matched)` on every `session_start` and `session_tree` restore, even when the model already matches.
- Gap: host `setModel` calls `this.sessionManager.appendModelChange` unconditionally (`agent-session.js:2011-2015`). Each restore writes a `model_change` entry to the branch leaf.
- Failure: each resume or tree navigation to a branch whose agent sets `model` appends an entry; navigation creates a new leaf. Count per resume is UNVERIFIED.
- Fix: skip `setModel` when the current model's `provider/id` equals `matched`.
- Confidence: medium (host code confirmed, runtime count not run).

F9 — low — Backend (escape injection)
- Current: `index.ts:80` `ctx.ui?.setTitle?.(\`Pi — ${activeAgent.name}\`)`, with `name` from `agents.ts:105` trimmed only.
- Gap: `name` and `description` are not sanitized. The host writes the title verbatim: `node_modules/@earendil-works/pi-tui/dist/terminal.js:475` writes `\x1b]0;${title}\x07`.
- Failure: `name: "x\u001b]0;pwned\u0007"` reaches the title string (probe S6). Terminal control sequences from a user or trusted project file reach the terminal. Exposure is limited to trusted sources.
- Fix: strip C0/C1 control characters from `name` and `description` in `loadDirectory`.
- Confidence: high for the string reaching the sink. Host sanitization is UNVERIFIED beyond `terminal.js:475`.

F10 — low — Simplicity
- Current: `index.ts:289-293` `project_trust` handler sets `lastCwd` and `lastTrusted = false`, then returns `{ trusted: "undecided" }`.
- Gap: the runner skips `undecided` results (`runner.js:115-117`), so the handler decides nothing. `restore()` later overwrites `lastTrusted`.
- Failure: none. Dead code that suggests a trust decision exists.
- Fix: delete the handler.
- Confidence: high.

F11 — low — Simplicity (duplicate seam)
- Current: `extensions/pi-subagents/src/agents.ts:54-115, 134-155` implements the same `loadDirectory` and `discoverAgents` over the same `<agentDir>/agents` and `.pi/agents`. It parses `body` as `systemPrompt` (`:106`), accepts `harness`, and silences parse errors (`:110`, `catch {`).
- Gap: one file is read by two loaders with different schemas. `/agent` shows a file that subagents treats as a prompt-bearing agent, and pi-agent drops the body silently.
- Failure: none at runtime. Schema drift is likely.
- Fix: move the loader to a shared module (`packages/core`, separate change). Until then, record the shared schema in one place.
- Confidence: high on duplication.

F12 — low — Simplicity
- Current: `agents.ts:20, 180` `projectAgentsDir` is set and never read outside `agents.ts`. `agents.ts:13, 121-124` plus `index.ts:138`, `picker.ts:110`, `popup.ts:29` treat `effort` as an alias of `thinking`. `index.ts:41` `createAgentExtension()` takes no parameters and `index.ts:422-424` wraps it.
- Gap: unused field, duplicate alias, and a factory with nothing to inject.
- Failure: none.
- Fix: drop the field and the alias (or document `effort` as the only supported name), and export the handler directly.
- Confidence: high.

F13 — low — UI
- Current: `index.ts:370-371` passes no active agent to `showAgentPicker`. `picker.ts:96-97` selects the first row, `(default)`.
- Gap: the active agent is not marked. Footer `picker.ts:133-136` truncates at width 40 to `↑↓ move  Enter select  Esc cancel  t`. Long descriptions are cut at the frame width (`picker.ts:107`).
- Failure: the user cannot see which agent is active from the picker. Width fit holds at 40, 80, 200 (probe8: 0 overflowing lines).
- Fix: pass `activeAgent?.name` and pre-select that row; shorten the footer or wrap it.
- Confidence: high for the marker gap. Overflow claims do not hold.

F14 — low — Backend (claim gap)
- Current: `index.ts:300-314` filters only `systemPromptOptions.skills`. `README.md:20` says "Strictly filters active skills".
- Gap: skills stay readable with the `read` tool if the agent keeps it, and `/skill:` invocation is not checked.
- Failure: the README overstates the restriction. Not checked against the live skill loader.
- Fix: reword the README to "omits filtered skills from the system prompt".
- Confidence: medium (UNVERIFIED loader path).

## Failure modes

- Reload or resume with an agent active (F1): tools lost for the session.
- Switch with history fails after fork (F2): the new session has no agent and an error notice.
- Round trip after tool changes (F4): late tools dropped, disabled tools re-enabled.
- Switch-back keeps thinking and model (F3).
- Switch while a turn streams (F5): turn aborted.
- Persisted agent missing, or project untrusted: `restore()` falls back to default with no notice (`index.ts:270-281`). The transcript still names the agent. Visible only as an empty status.
- Duplicate `name` (F6) and reserved `default` (F7): silent shadowing or unreachable agent.
- Picker and overlay lock: `picker.ts:62-72` releases `withPromptLock` only through `onSelect`, `onCancel`, or `done`. If the host hides the overlay without `done`, the lock stays held (V20 shared-package issue; slice usage only).
- Discovery reads every agent file on every Tab (`index.ts:322`): fine at expected size.

## Seams

- Host tool API: `setActiveTools` ignores unregistered and hidden names (`agent-session.js:1175-1181`). The slice's snapshot is a second source of truth for the same set (F1, F4).
- Host model and thinking API: `setModel` writes transcript entries (F8). The slice calls it on restore.
- Fork and replacement: `ctx.fork` and `withSession` (F2, F5).
- `enterMode` (`index.ts:105, 178`, V22 shared): `applyAgent` calls it on every restore with `agent.mode`. Whether that writes session entries is UNVERIFIED.
- Prompt lock (`picker.ts:62`, V20 shared): see Failure modes.
- pi-subagents loader (F11): shared directory, separate parser.
- pi-web and pi-language-tools (`a035b03`): they remove direct web tools and `lang` at `session_start`. Their handler order relative to pi-agent's capture does not change the outcome, because the exposure filter drops the same tools.

## Rejected defaults

- Project agents load only when `ctx.isProjectTrusted()` (`index.ts:266, 341`; `agents.ts:168`). This is the intended default.
- `setActiveTools` silently ignores unknown names. Host default; the slice relies on it in F1.
- Picker `maxHeight: "75%"` and `margin: 1` (`picker.ts:165-168`). Default overlay sizing.
- Per-keystroke discovery (`index.ts:322`). No measured cost; expected load is under 20 files.
- Fuzzy filter over name, description, and model (`picker.ts:80-83`). Default search, correct.

## Open Questions

1. Should an agent's `tools` be allowed to name codemode-only or hidden tools (`index.ts:152`)? Today they are declared to the model, which may reverse the `a035b03` intent.
2. On a switch while streaming (F5), should the switch queue, refuse, or abort? The answer decides the F5 fix.
3. Should model and thinking be session-sticky (current behavior) or restored to pre-agent values (F3)?
4. Should `default` be a reserved agent name with a diagnostic (F7), or should the reset command move to a different keyword?
5. Should `~/.pi/agent/agents` have one schema shared by pi-agent and pi-subagents (F11)?

## Verdict

fail

Reason: F1 and F2 are both high (lost tools after reload or resume, agent not applied after fork). Both need fixes before the slice is accepted.
