# Architectural Exploration: Stop Reinventing Web, Subagents, and Todos

Status: Draft for decision. Date: 2026-10-29.
Scope: `extensions/pi-web`, `extensions/pi-subagents`, `extensions/pi-todos`.

## Destination

One of these is true for each capability:

1. A maintained upstream Pi extension is the engine, and this workspace keeps
   only the adapter needed for its own event/UI contracts.
2. The local implementation remains, with a written reason why upstream cannot
   serve the integration, plus probes proving the critical paths.

The user-visible outcome: web search works without API keys, a dead subagent
never shows as running, cancelling actually stops the child, and open todos are
never hidden behind completed rows.

## References

- `artifacts/research/pi-extension-landscape.md` — versions, feature matrix,
  source citations, and upstream defects.
- `artifacts/review/pi-web.md`, `pi-subagents.md`, `pi-todos.md` — verified
  local defects and probe output.
- `artifacts/scripts/probe-web-ssrf.ts` — `localtest.me` and `nip.io` allowed.
- `artifacts/scripts/probe-web-fallbacks.ts` — empty search stops fallback;
  non-OK body not canceled.
- `artifacts/scripts/probe-subagents-lifecycle.ts` — starting child marked
  failed; abort leaves a live process alive.
- `artifacts/scripts/probe-todos-overflow.ts` — ten completed rows hide both
  open rows.
- npm: `pi-web-access@0.46.0`, `pi-subagents@0.84.0`, `rpiv-todo@1.1.0`.

## Archetypes

### A. Adopt upstream wholesale

Remove the local engines and enable `pi-web-access`, `pi-subagents`, and
`rpiv-todo` as packages.

- Web: immediate zero-config search, DNS-aware SSRF, PDF/YouTube/GitHub
  handling, and many providers.
- Subagents: foreground/background runs, fleet UI, workflows, RPC, and cost.
- Todos: a real `todo` tool with `blockedBy` and a native overlay.

Failure modes: duplicate tool registration (`web_search`, `subagent`, `todo`)
if the old packages stay enabled; our `subagents:state` event disappears and
the combined panel goes empty; the text-block todo prompt conflicts with the
`todo` tool; `rpiv-todo` targets the `@mariozechner` host scope, not
`@earendil-works`; three new dependency trees and config files enter the
workspace.

Blast radius: high. Coupling: low code, high host/API coupling. YAGNI: strong,
because none of the three should be maintained here.

### B. Keep the local shells, replace the engines

Keep the tool names, event contracts, config paths, and panel, but move the
dangerous or mature internals behind adapters.

- `pi-web`: keep `web_search`/`web_fetch` params and codemode exposure; delegate
  transport to `pi-web-access` if it exposes a library seam, or port its
  `ssrf-protection.ts` and keyless provider under MIT attribution.
- `pi-subagents`: keep the `subagent` tool and `subagents:state`, but replace
  the runner state machine with upstream's lifecycle/event API. If upstream has
  no programmatic launch seam, keep our runner and port only the lifecycle
  invariants.
- `pi-todos`: keep text blocks and the combined panel; port `blockedBy`, cycle
  detection, and drop-completed-first overflow from `rpiv-todo`; fix the
  upstream branch-cache bug before reusing its replay logic.

Failure modes: adapter drift when upstream changes; two sources of truth for
config and state; upstream internals may not be a supported library; wrapper
tests must pin both sides.

Blast radius: medium. Coupling: medium. YAGNI: mixed; adapters are justified
only where our event contract has a real consumer.

### C. Harden in place and borrow patterns only

Keep all three engines. Fix the verified defects and copy the smallest proven
patterns from upstream.

- Web: DNS resolution plus CIDR checks on every redirect, bounded body reads,
  body cancellation on every exit, empty-result fallback, keyless provider.
- Subagents: connectability not `existsSync`, no reconciliation during the
  startup grace window, kill the process group before marking cancelled,
  atomic state writes, start-time PID checks.
- Todos: process blocks without UI, handle `session_compact`, dispose terminal
  listeners, drop completed rows before open rows, add `blockedBy`.

Failure modes: we still own three security- and lifecycle-sensitive wheels;
upstream will keep moving; the next bug is ours to find.

Blast radius: low per patch. Coupling: low. YAGNI: weak; duplicates continue.

## Trade-offs

| Criterion | A. Adopt | B. Shell + engine | C. Harden |
| --- | --- | --- | --- |
| Time to robust web | days | days | weeks |
| Time to robust subagents | days | weeks | weeks |
| Preserve `subagents:state` panel | no, needs adapter | yes | yes |
| Preserve text-block todos | no | yes | yes |
| New dependency weight | high | medium | none |
| Security ownership | upstream | split | local |
| Blast radius | high | medium | low |
| Drift risk | low | medium | high |
| Fits this monorepo's integration | weak | strong | strong |

## Recommendation

Use B, sequenced by coupling:

1. **Web: adopt.** It has no local consumers besides its own tools, and
   upstream is strictly stronger on SSRF, keyless search, and extraction. If a
   library seam is unavailable, run `pi-web-access` as the only web extension
   and delete local `pi-web` rather than wrapping it.
2. **Subagents: adapter or harden, not wholesale yet.** Our panel and statusline
   consume `subagents:state`; upstream publishes a different event/RPC surface.
   First probe whether its RPC can feed our event. If not, keep our runner and
   fix the four lifecycle bugs before adding features.
3. **Todos: keep and fix.** `rpiv-todo` has real replay defects, a conflicting
   tool/prompt model, and a mismatched peer scope. Port only the dependency
   graph and overflow policy. Do not adopt it as the engine.

Do not start with a rewrite of all three. The verified probes in
`artifacts/scripts/` are the acceptance gate for whichever direction is chosen.

## Not yet specified

- Whether `pi-web-access` exposes a supported library entrypoint for embedding,
  or only a Pi extension default export.
- Whether upstream `pi-subagents` RPC can emit a state shape compatible with
  `pi-todos`/`pi-statusline` without forking it.
- Whether text-block todos are a product requirement or an accident of the
  current prompt contract.
- Whether the workspace accepts third-party runtime dependencies by default.

## Out of scope

- Rewriting `pi-statusline`, `pi-guard`, or `pi-budgets`.
- Migrating existing session history or todo entries.
- Upstream contributions or patches to the three packages.
- Any release, migration guide, or backwards-compatibility layer.

---

# Architectural Exploration: Classifier Decision Contract

Status: Draft for decision. Date: 2026-10-30.
Scope: `extensions/pi-decide`. Prior web/subagents/todos exploration above is preserved.

## Destination

`decide` becomes a bounded, session-scoped advisory classifier with predictable
failure and testable production seams.

User-visible outcomes:

1. Cached results never cross session boundaries.
2. Repeated calls in one session stay cheap; aborted calls do not poison other
   waiters.
3. Malformed classifier answers become explanatory text, not impossible values.
4. `score` returns the selected level label required by R23.
5. No fake agent directory or test-only dependency path remains in production.

## References

- `artifacts/review/pi-decide.md` — verified robustness and overengineering
  findings.
- `artifacts/requirements.md` — R23-R28.
- `artifacts/decisions.md` — D88-D93.
- `artifacts/specs.md` — S88-S93.
- `extensions/pi-decide/src/decide.ts` — tool, cache, timeout, normalize.
- `extensions/pi-decide/src/config.ts` — explicit model config and input
  bounds.
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:465-510` — classifier
  answers contain `score`, not a score label.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:178`
  — `ReadonlySessionManager` exposes `getSessionId()`.
- `extensions/pi-web/src/providers/selection.ts:71-72` — existing
  `AbortSignal.any` pattern in this workspace.

No external research was needed; the contested choices are repository contract
questions, not provider documentation questions.

## Current Gaps That Are Not Open Questions

- R23 requires `score` to return `index`, `label`, and `confidence`.
  `normalize` returns only `value` and `confidence`. This is a contract bug, not
  a design preference.
- R26/D91 say "per session"; the cache is currently per `createDecideTool`
  instance, which spans sessions.
- D90/R25 says aborted calls fail cleanly; the caller signal is not forwarded,
  so a cancelled caller can leave the request running.
- The review's `DecideDeps` finding is real: `defaultDeps.getAgentDir` returns a
  fake path, and the exported `decideTool` singleton is unused.
- Unbounded cache growth and full-input cache keys are robustness issues even
  though the cache itself is required.

## Design Questions

1. **Session identity:** key cache state by `ReadonlySessionManager` object,
   `getSessionId()`, or clear the cache on `session_start`?
2. **Abort sharing:** should one caller aborting cancel the shared request when
   other callers are still waiting? Only when no waiter remains?
3. **Cache bounds:** fixed entry cap, byte cap, or configurable? TTL alone does
   not bound memory.
4. **Config lifecycle:** load `decide.json` once at extension load (current)
   or re-read per session/per call? Diagnostics depend on this choice.
5. **Output trust:** reject invalid `choice`/`score`/probability answers, or
   clamp/repair them? R25 says fail with text.
6. **Test seam:** keep dependency injection for `classify`, or test through
   `ctx.modelRegistry` and a real config file?

## Archetypes

### A. Session-scoped tool state, minimal evolution

Keep one `decide.ts` tool factory; move state from module/instance scope to a
session-scoped container.

- `createDecideTool(config)` takes the loaded config and uses
  `ctx.modelRegistry` for classification.
- `WeakMap<ReadonlySessionManager, SessionState>` owns the TTL cache and
  in-flight map; entries are bounded and keys are hashes of the canonical
  request.
- Each caller races the shared task against its own abort signal. The shared
  request is aborted only when its last waiter aborts.
- `normalize` validates the answer against caller labels, score range, and
  probability bounds; score output maps the index back to `labels[index].label`.
- Remove `DecideDeps`, `defaultDeps`, `getAgentDir` from the tool deps, and the
  unused `decideTool` singleton.
- Tests write `decide.json` through `PI_CODING_AGENT_DIR` or pass a config
  object; fake `ctx.modelRegistry` supplies classifier results.

Failure modes: `WeakMap` cache is lost on resume or fork; watcher/refcount bugs
can abort a shared request too early; one file grows.

### B. Pure decision core plus session-state adapter

Split the contract from the state machine.

- `decide-core.ts`: validate params, build classifier payload, normalize and
  validate answers. No cache, no timers, no session access.
- `session-cache.ts`: session-scoped TTL cache, bounded eviction, in-flight
  sharing, caller-abort subscriptions.
- `decide.ts`: thin Pi tool adapter that resolves config, calls the cache, and
  formats tool results.
- `index.ts`: loads config and registers the adapter.

Failure modes: three modules for one tool; the cache module still has the hard
abort semantics; tests must pin both core and adapter.

### C. Process-wide bounded cache with hashed keys

Keep one cache across sessions; fix only bounds, abort, and output validation.

- One LRU with hashed keys; TTL; caller abort races.
- No session key; identical requests in different sessions share a result.

Failure modes: violates R26/D91 and weakens the "private input does not persist
across sessions" expectation. A bounded cache makes the leak smaller, not
correct.

## Trade-offs

| Criterion | A. Session tool state | B. Pure core + adapter | C. Process cache |
| --- | --- | --- | --- |
| R26 per-session semantics | Correct if keyed by manager | Correct | Violates |
| Memory bounded | Yes | Yes | Yes, but cross-session |
| Abort correctness | Refcount complexity | Isolated, testable | Simpler, still wrong scope |
| Testability | Medium; fake ctx/config | High; pure core | Low; hidden global state |
| Module count | 1-2 | 3 | 1 |
| Blast radius | Low | Medium | Low code, high contract risk |
| YAGNI | Strong for one tool | Weak until cache grows | Strong but wrong |

## Recommendation

Choose **A now**. It fixes the actual contract and robustness gaps without
inventing a service layer for one tool.

Concrete decisions:

1. Remove `DecideDeps`, `defaultDeps`, the fake agent-dir path, and the unused
   `decideTool` singleton. `createDecideTool(config)` uses `ctx.modelRegistry`.
2. Key cache/in-flight state by `ctx.sessionManager` in a `WeakMap`; cap entries
   per session and hash the canonical key. Loss on resume is acceptable and
   matches "new session hits classifier again."
3. Combine the configured timeout with caller abort. A caller abort returns
   `aborted` immediately; the shared request is aborted when no waiter remains.
   Never cache an aborted call.
4. Validate `choice` labels, `score` integer range, and probability bounds.
   Return `decide unavailable: ...` for malformed answers. Add the R23 score
   label mapping.
5. Keep explicit model selection, direct-only exposure, and payload privacy
   unchanged.
6. If the cache/abort logic grows beyond a compact helper, promote only that
   helper to `session-cache.ts`; do not split the validation core until a second
   consumer exists.

## Not yet specified

- Whether `decide.json` should hot-reload per session or remain load-once.
- Whether the per-session cache cap is fixed (for example 100 entries) or
  configurable.
- Whether the shared request should abort immediately when its last waiter
  aborts, or run to the configured timeout.
- Whether a completed result should be cached if every waiter had already
  aborted.
- Whether `choice` probabilities must include every caller label exactly, or
  only be a subset with valid numbers.
- Whether the exported `decideTool` singleton is a supported public seam or
  should be deleted.

## Out of scope

- New classifier providers, model routing, or fallback models.
- Automatic redaction or local-only enforcement.
- Disk cache or persistent decision history.
- Multiple questions per tool call or free-form rationales.
- CLI, service registry, codemode activation, or `pi-guard` integration.
- Changing D88-D93 without a separate decision record.

---

# Architectural Exploration: fd/rg Duplication and Prompt Leanness

Status: Draft for decision. Date: 2026-10-30.
Scope: `extensions/pi-tools`, Pi system prompt size, and search-tool schema.

## Destination

The model gets one clear search surface. Since built-in `grep`/`find` are
already excluded and `bash` is sufficient, `fd`/`rg` are the remaining direct
search schemas. The outcome is a smaller active tool schema without losing a
capability the user actually uses.

The user-visible outcome:

1. Search and file discovery remain available through `bash` (`rg`, `fd`, `ls`).
2. The direct tool schema no longer pays for `fd`/`rg` unless their structured
   behavior is worth the bytes.
3. `/cd` keeps a purpose only if built-in file tools and guard rewrites still
   use the effective working directory.

## References

- `artifacts/research/pi-system-prompt-2026-10-30.md` — full live Pi 1.4.0
  system prompt captured from the RPC `message_start` system message. Date:
  2026-10-30. Configuration excludes built-in `grep`/`find`.
- `artifacts/research/pi-rpc-events-grep-find-2026-10-30.jsonl` — current
  baseline: 15 active tools, 10,032-byte prompt, 5,990-byte schemas, 5,223-byte
  descriptions.
- `artifacts/research/pi-rpc-events-fd-rg-grep-find-2026-10-30.jsonl` — removing
  `fd`/`rg` leaves `bash` as the search path: 13 tools, 20,200 total bytes.
- `extensions/pi-tools/src/fd.ts` and `rg.ts` — per-result deny filtering and
  root containment.
- `extensions/pi-guard/src/index.ts:40-43` — `fd`/`rg` map to the `search` tag;
  `bash` maps to `shell`.
- User confirmation, 2026-10-30: built-in `grep`/`find` are not included;
  `bash` is enough.

## Prompt dissection

The current live prompt is 10,032 bytes. Active schemas add 5,990 bytes and
tool descriptions add 5,223 bytes: 21,245 bytes, about 5,311 tokens at four
bytes per token.

| Section | Bytes | Share of prompt |
| --- | ---: | ---: |
| `project_context` | 3,086 | 31% |
| `addendum` | 2,515 | 25% |
| `docs` | 1,424 | 14% |
| `rules` | 927 | 9% |
| `todos_format` | 749 | 7% |
| `question_format` | 638 | 6% |
| `tools` | 461 | 5% |
| `preamble` | 169 | 2% |
| `cwd` | 47 | <1% |

`fd` and `rg` have no prompt snippets, so removing them leaves the prompt text
unchanged. Their direct definitions cost 1,045 bytes:

| Tool | Schema | Description | Total |
| --- | ---: | ---: | ---: |
| `rg` | 421 | 148 | 569 |
| `fd` | 336 | 140 | 476 |
| **Both** | **757** | **288** | **1,045** |

The prompt is dominated by `project_context` and `addendum` (5,601 bytes
combined), not the search tools. Removing `fd`/`rg` is a 4.9% reduction of the
whole input surface.

## Archetypes

### A. Bash-only search (remove fd/rg)

Remove both direct tools. Use `bash` with `rg`, `fd`, and `ls` for search and
discovery. Keep `/cd` only if built-in file tools still need the effective
working-directory override.

- Structure: remove `fd`/`rg` registration from `pi-tools`; no schema change to
  `bash`; no built-in `grep`/`find` reactivation.
- Savings: 1,045 bytes (~261 tokens); prompt text unchanged.
- Failure modes: every search becomes a shell call, so `pi-guard` uses the
  `shell` tag and may prompt; output is unstructured and truncated by the bash
  tool; per-result deny filtering is lost; the model must know `rg`/`fd` flags.
- Coupling: low code, higher behavioral coupling to shell policy. Blast radius:
  medium. YAGNI: strong if `bash` is already the intended search path.

### B. Keep fd/rg as the structured search surface

Keep both direct tools and accept 1,045 bytes. Use `/cd` and the per-result
filtering they provide.

- Structure: current `pi-tools` registration; optionally document that
  `fd`/`rg` replace built-in search.
- Savings: none.
- Failure modes: duplicate intent with `bash`; external `fd`/`rg` binaries;
  schema and description cost every request; model may still choose bash.
- Coupling: low. Blast radius: low. YAGNI: weak on prompt budget, strong on
  policy filtering.

### C. Reintroduce built-in grep/find

Remove `fd`/`rg` and reactivate Pi's built-in `grep`/`find`.

- Structure: keep `pi-tools` for `/cd`; change default tool selection to include
  built-in search.
- Savings: negative. Built-in definitions are larger: `grep` is 1,014 bytes and
  `find` is 591 bytes; the tool section also grows by 121 bytes. Net change is
  roughly +681 bytes versus the current setup.
- Failure modes: built-ins do not provide the per-result deny filter; users
  intentionally disabled them; schema grows rather than shrinks.
- Coupling: low. Blast radius: low. YAGNI: weak.

### D. Keep both search paths and trim elsewhere

Keep `fd`/`rg`; reduce `project_context` or `addendum` instead.

- Structure: no tool change; edit global/project instructions.
- Savings: potentially larger than 1KB, but changes user-facing guidance and
  may remove repository-specific rules.
- Failure modes: loses operational constraints; not a tool-surface decision.
- Coupling: low. Blast radius: high for instructions. YAGNI: mixed.

## Trade-offs

| Criterion | A. Bash-only | B. Keep fd/rg | C. Built-ins | D. Trim prompts |
| --- | --- | --- | --- | --- |
| Bytes saved | 1,045 | 0 | -681 | prompt-dependent |
| Rough token saved | 261 | 0 | -170 | prompt-dependent |
| Direct search schema | none | fd/rg | grep/find | fd/rg |
| Per-result deny filter | lost | retained | lost | retained |
| Shell approval noise | higher | lower | lower | lower |
| Binary dependencies | bash + rg/fd | fd/rg | native | fd/rg |
| Prompt text change | 0 | 0 | +121 B | user edits |
| Fit with user statement | strongest | weak | contrary | orthogonal |

## Recommendation

Use **A, bash-only search**, because built-in `grep`/`find` are already excluded
and `bash` is the stated search path. Remove `fd`/`rg` registration. Keep
`pi-tools` only if `/cd` still earns its place for built-in file tools and
`pi-guard` path rewriting; otherwise retire the package's tool surface.

Accept one trade-off explicitly: `bash` does not provide the per-result deny
filter that `fd`/`rg` added. If that filter is a hard requirement, use **B**
instead and document that `fd`/`rg` are the canonical direct search tools.

The larger lean opportunity remains `project_context` (3,086) and `addendum`
(2,515), not the 1,045-byte search pair.

## Open Questions

See `artifacts/questions.md#brainstorm--fdrg-duplication`.

## Out of scope

- Editing production source or git state.
- Reintroducing built-in `grep`/`find` without a policy decision.
- Trimming `AGENTS.md`, global addendum, docs, or question/todo prompt sections.
- Implementing a merged `search` tool or codemode migration.
- Changing model/provider defaults or release packaging.

---

# Architectural Exploration: pi-tools After Search Removal

Status: Draft for decision. Date: 2026-10-30.
Scope: `extensions/pi-tools`, notifications, sandbox wiring, and workspace utilities after removing `fd`/`rg`.

## Destination

`pi-tools` stops carrying a duplicate search schema and becomes either a small
workspace command package or is retired. The suite gains a real completion
notification path and a truthful sandbox story instead of an unused primitive.

The user-visible outcome:

1. `fs`/`rg` are removed; `bash` is the search path.
2. Long-running tasks, subagents, questions, and errors can notify the OS when
   the user is not focused on Pi.
3. Sandboxing has an explicit boundary: either the whole Pi process runs in a
   container/`bwrap`, or specific spawned commands run under the core sandbox.
4. `/cd` remains only if it still changes behavior for built-in file tools and
   guard path rewriting.

## References

- `artifacts/research/pi-system-prompt-2026-10-30.md` — current 15-tool Pi 1.4.0
  prompt; `fd`/`rg` cost 1,045 definition bytes and no prompt text.
- `artifacts/research/pi-rpc-events-grep-find-2026-10-30.jsonl` — current
  no-built-in-grep/find baseline.
- `artifacts/research/pi-rpc-events-fd-rg-grep-find-2026-10-30.jsonl` — bash-only
  variant after `fd`/`rg` removal.
- `packages/core/src/sandbox.ts:5,69,108` — Bubblewrap options, argument builder,
  and fail-closed wrapper.
- `packages/core/src/exec.ts:9,16,48` — `sandbox` is opt-in on `runCapture` and
  `runBinary`; no production extension passes it.
- `extensions/pi-tasks/src/runner.ts` — background tasks use
  `spawnDetachedProcess`, not the core sandbox wrapper.
- Pi docs: `security.md:39,99` says tools run with process permissions and Pi has
  no built-in sandbox; `terminal-setup.md:223` documents OSC 7501 program
  status; `rpc-extension-ui.md:97` documents fire-and-forget `notify`.
- OpenCode notifier plugin (`mohak34/opencode-notifier`): native notifications,
  sound/bell, permission/complete/error/question events, focus suppression,
  duration threshold, and command hooks.
- OMP README (`can1357/oh-my-pi`): IDE/ACP integration, LSP operations, native
  search/shell, persistent Python/JS kernels, workspace isolation, subagent
  fan-out, debugger, memory, and collaboration. It is a broader product, not a
  drop-in for this package.

## Current state

- Notifications: `ctx.ui.notify` is in-process only; RPC forwards a
  fire-and-forget notification frame; Pi reports program status via OSC 7501 and
  optional OSC 9;4 progress. There is no OS desktop notification extension in
  this repository.
- Sandbox: a working core primitive exists (`bwrap` with read-only root,
  workspace writable bind, tmpfs `/tmp`, masked `~/.ssh`/`~/.gnupg`, optional
  network isolation, fail-closed when `bwrap` is absent). It is not wired to any
  tool, task, or subagent, and built-in `bash` cannot be wrapped by an extension
  hook.
- `pi-tools` after `fd`/`rg`: only `/cd` remains, which changes effective cwd
  and causes `pi-guard` to rewrite relative path arguments. It does not change
  the process cwd.

## Archetypes

### A. Retire pi-tools, keep only core workspace state

Remove `fd`/`rg` and either move `/cd` into `pi-guard` or drop the command.
No new package surface.

- Structure: delete `pi-tools` registration; `pi-guard` already owns path
  rewriting and could own the cwd command.
- Savings: 1,045 definition bytes; zero new prompt/tool cost.
- Failure modes: users lose the `/cd` command; moving it couples workspace
  state to policy; completion and statusline cwd displays change.
- Coupling: low. Blast radius: low. YAGNI: strongest.

### B. Keep pi-tools as a command-only workspace package

Remove `fd`/`rg`; keep `/cd` and add a small `/open` or workspace command if
it has a concrete use.

- Structure: no tool schemas; `pi-tools` becomes commands and status only.
- Savings: 1,045 definition bytes; command surface remains.
- Failure modes: command-only packages are hard to justify; `/cd` already has a
  policy coupling; adding commands without a user request is speculative.
- Coupling: low. Blast radius: low. YAGNI: mixed.

### C. Repurpose pi-tools for sandbox control

Remove `fd`/`rg`; add `sandbox.json` and a `/sandbox` command; wire the core
Bubblewrap wrapper into background tasks and any extension-run command, not
built-in `bash`.

- Structure: `extensions/pi-tools/src/sandbox-config.ts`, command registration,
  `runCapture`/`runBinary` callers pass `sandbox: true`; `pi-tasks` runner gets a
  sandbox option; document that built-in `bash` still needs a container or
  outer wrapper.
- Savings: 1,045 bytes; no new tool schema.
- Failure modes: false sense of security if users think `bash` is sandboxed;
  bwrap unavailable on macOS/Windows; task sandboxes need writable workspace and
  dependency/network allowances; masked paths must not break builds.
- Coupling: medium/high to process and task lifecycle. Blast radius: high.

### D. Add pi-notify, leave pi-tools command-only

Remove `fd`/`rg`; create a notification extension that listens to completion,
error, question, task, and subagent events; use OS-native notification commands
or terminal bell/OSC with configurable events.

- Structure: `extensions/pi-notify`; no model tool; config `notify.json`;
  platform adapters (`notify-send`, `osascript`, `terminal-notifier`, bell/OSC);
  suppress when focused, minimum duration, dedupe, and no secrets in messages.
- Savings: 1,045 bytes from search; notification extension adds no tool schema.
- Failure modes: shelling out to `notify-send`/`osascript` can hang or leak
  titles; duplicate notifications from multiple events; focus suppression needs
  a reliable signal; Windows support needs a separate adapter.
- Coupling: low to tool execution, medium to event contracts. Blast radius: low.

### E. OMP-style workspace isolation for tasks/subagents

Remove `fd`/`rg`; add per-task worktrees or overlay isolation, inspired by OMP's
`pi-iso` and subagent fan-out, rather than a command package.

- Structure: workspace allocator around `pi-tasks`/`pi-subagents`; worktree
  lifecycle, cleanup, merge policy, and path scoping.
- Savings: search schema only; adds significant new state and prompt/UI.
- Failure modes: merge conflicts, orphaned worktrees, repo size, subagent
  write-lock conflicts, and cleanup on crash.
- Coupling: high. Blast radius: broad. YAGNI: weak for the current suite.

## Trade-offs

| Criterion | A. Retire | B. Command-only | C. Sandbox | D. Notify | E. Worktrees |
| --- | --- | --- | --- | --- | --- |
| Removes 1,045 B | yes | yes | yes | yes | yes |
| New tool schema | none | none | none | none | none |
| New prompt text | none | none | small | none | medium |
| OS notification | no | no | no | yes | no |
| Sandbox enforcement | no | no | partial | no | no |
| Built-in bash covered | no | no | no | no | no |
| Security value | none | none | high if wired | none | medium |
| Blast radius | low | low | high | low | high |
| Fit with current suite | high | medium | medium | high | low |

## Recommendation

Sequence after the `fd`/`rg` removal:

1. **Decision: remove `fd`/`rg`.** Keep `/cd` only if it still changes built-in
   file behavior and guard rewrites. Do not add a command-only package without
   a concrete use.
2. **Add D (`pi-notify`) before C.** Notifications are low-risk, no-schema, and
   directly useful for tasks/subagents/questions. Mirror only the useful
   OpenCode notifier ideas: completion, error, question, task/subagent done,
   focus suppression, and a minimum duration.
3. **Treat C as a separate security project.** Use the existing `bwrap`
   primitive for spawned commands, but state clearly that built-in `bash` is
   not sandboxed; the only real whole-agent boundary is running Pi in a
   container or under an outer sandbox. Do not advertise C as covering bash.
4. **Defer E.** Worktree isolation is a large feature with merge/lifecycle
   costs; it is not justified until tasks/subagents regularly collide.

## Open Questions

See `artifacts/questions.md#brainstorm--pi-tools-after-search-removal`.

## Out of scope

- Editing production source or git state.
- Whole-agent containerization.
- Implementing notifications, sandbox config, or worktrees.
- Adding OpenCode/OMP feature parity wholesale.
- Changing `pi-guard`, `pi-tasks`, or `pi-subagents` contracts.

---

# Architectural Exploration: Review V19–V38 Remediation

## Destination

The user can run every extension in the default set without these failures:

- A silent permission bypass.
- A crash of the TUI.
- A lost config file.
- An orphan process.
- A hung prompt.

Each defect class is fixed once, in the module that owns it. A new extension that uses the shared seam cannot reintroduce the defect.

## References

- Findings: `artifacts/review/` files for V19–V38, as registered in `artifacts/reviews.md`.
- Module seams: `artifacts/architecture.md` (Module Seams, Dependency Direction).
- Host contracts: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`:
  - `ReplacedSessionContext` at :329.
  - `ExtensionUIDialogOptions.signal` and `.timeout` at :36-44.
- Host width guard: `node_modules/@earendil-works/pi-tui/dist/tui-main-screen.js:474-487`. The TUI stops and throws on an overlong line.
- No external research was needed. All contracts are local source.

## Defect classes and seam evidence

Each class has the same defect in several owners. Counts come from `rg` over non-test source at `a035b03`.

| Class | Findings | Current owners |
|---|---|---|
| Config save overwrites a file that does not parse | V25-F3, V27-F3, V29-F6, V34-F7 | 4 private writers: `pi-web`, `pi-statusline`, `pi-guard`, `pi-dashboard` `src/config.ts`. Core `config.ts` only loads. |
| Process-tree kill | V21-F2/F4/F5, V24-F1, V26-F2, V31-F2, V37-F3 | 1 primitive (`runtime/process.ts:173`).<br>7 hand-rolled kills: `runner-shim.mjs`, `shim.cjs`, `lsp.ts`, `pi-acp` x3, `exec.ts`. |
| Terminal control bytes reach render | V24, V29-F3, V30-F12, V31-F5, V32-F9, V34-F10, V36-F3 | No sanitize helper exists. |
| Prompt lock without abort or timeout | V20-F1, V22-F4/F5, V36-F8/F9 | 1 lock (`core/prompt-lock.ts`), 8 consumer files. |
| Line wider than the terminal | V30-F1, V28-F9/F17 | Each component truncates by itself. |
| Cost source split | V33-F3, V35-F1/F3, V19 | 4 readers with different rules. |
| Permission core | V22-F1/F2/F3, V29-F1/F2/F4, V37-F1, V38-F2 | `core/policy.ts`, `core/shell.ts`, `pi-guard/rules.ts`. |

Constraint: `runner-shim.mjs` and `shim.cjs` run under plain `node` and import only `node:*` modules. They cannot import TypeScript workspace packages without a build or jiti.

## Archetypes

### A. Patch in place, per slice

- Philosophy: fix each finding in the file that the review cites, and add no new shared surface.
- Structure: only the edits already listed in the review files. For example, add `Object.hasOwn` in `pi-statusline/src/config.ts:372`, `truncateToWidth` in `pi-todos/src/todos.ts:425`, and a parse check in each of the 4 `saveX` functions.
- Order: highs by slice, then mediums.

### B. Contracts first, in shared packages

- Philosophy: add one primitive per defect class, then migrate every consumer to it.
- Structure:
  - `packages/core/src/config.ts`: `updateJsonConfig(path, mutate)`. It refuses to write when the file exists and does not parse. It writes temp+rename.
  - `packages/core/src/format.ts`: `sanitizeTerminalText(text)`. It strips C0/C1 and OSC, and it keeps or drops SGR.
  - `packages/runtime/src/process.ts`: `killTree(pid, graceMs)`, used by `exec.ts`, `lsp.ts`, and `pi-acp`. The shims get a generated or copied JS twin.
  - `packages/core/src/prompt-lock.ts`: `withPromptLock(fn, { signal, timeoutMs })`.
  - `packages/core/src/usage.ts`: one `messageCost(message, pricing)`.
  - `packages/core/src/shell.ts`: a destructive-command set (Q15).
- Order: all contracts, then all consumers, then the single-owner highs.

### C. Severity-gated hybrid with a rule of three

- Philosophy: fix single-owner highs in place now. Extract a shared primitive only when three or more owners have the same defect today. Send policy choices (Q15, Q16) through design before code.
- Structure:
  - In-place highs, one owner each:
    - pi-agent F1.
    - pi-statusline F1.
    - pi-todos F1.
    - pi-modal F1/F2.
    - pi-question F1.
    - pi-dashboard F1.
    - pi-memory F1.
    - pi-acp F1/F2/F3.
    - pi-usage F1 (core `usage.ts:329`).
  - Extractions that meet the rule of three:
    - `updateJsonConfig`, for 4 owners.
    - `sanitizeTerminalText`, for 7 owners.
    - Prompt-lock `signal`/`timeout`, for 8 consumers.
    - `killTree`, for 7 hand-rolled kills.
  - Design-gated, with code after a decision:
    - Permission core: V22-F1/F2/F3 and V29-F1/F2/F4 interact through one precedence order.
    - Cost source (Q16).
    - Destructive shell (Q15).
- Order:
  1. Permission and exposure highs.
  2. Crash highs.
  3. Data-loss highs.
  4. Extractions.
  5. Mediums.

## Trade-offs

| Dimension | A. Patch in place | B. Contracts first | C. Hybrid |
|---|---|---|---|
| Coupling | Low. No new imports. | High. Every consumer gains a core or runtime import. | Medium. New imports only where 3+ owners share a defect. |
| Blast radius | Isolated per file. | Broad. One contract change touches 4–8 packages at once. | Isolated for highs. Broad only per extraction, one class at a time. |
| YAGNI | Clean now, but the same fix is copied 4–8 times. | Premature for classes with 1–2 owners (width, cost). | Clean. Only proven repeats are extracted. |
| Time to first safe state | Shortest for single-owner highs. | Longest. Highs wait behind contracts. | Short. Highs land first. |
| Failure mode | Drift: the 5th config writer or the next overlay repeats the bug, and copies diverge (V27-F3 vs V34-F7 already differ). | Big-bang regression: a `withPromptLock` signature change breaks 8 call sites in one commit, and a bad sanitize rule strips colors everywhere. | Interim inconsistency: some owners use the primitive before others migrate. Shims keep a copied kill until Q20 is decided. |
| Discoverability | Low. The fix is buried in each slice. | High. One named seam per class. | High for extracted classes, low for one-off fixes, which matches their scope. |

## Recommendation

Archetype C fits the repository conventions:

- AGENTS.md assigns shared shell analysis and policy to `packages/core`. It assigns process primitives to `packages/runtime`, and it says to never vendor them in extensions. The four extracted classes already violate that rule by duplication, so extraction removes debt and adds no speculative surface.
- The worker rules ask for the minimal diff and no premature abstraction. The rule of three keeps width and cost out of shared code until they repeat.
- Permission and exposure highs go first. Correctness and security findings block completion under the review skill, and they need one precedence decision before code.

## Open Questions

See `artifacts/questions.md`, section `### Brainstorm — review remediation`. Cross-cutting policy questions Q15–Q18 are already registered there under the V19–V38 review heading.

## Out of scope

- Medium and low findings that have a single owner and no shared seam. Those stay in each review file for per-slice work.
- Host defects reported in reviews, such as `pi-tui` `Editor.render` recursion at width ≤ 2 (V28-F17), and a host cursor setter for pi-modal (V28-F6/F7/F8).
- Re-running any review slice.
- Requirements and decisions changes. Design owns those.
