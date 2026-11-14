# Upstream Pi extension landscape

Date: 2026-10-29. Evidence from published npm tarballs unpacked under
`/tmp/opencode/upstream/` and from this repo's source.

| Package | Version | Repo | Peer host scope |
| --- | --- | --- | --- |
| `pi-web-access` | 0.46.0 | `nicobailon/pi-web-access` | `@earendil-works/pi-*` |
| `pi-subagents` | 0.84.0 | `nicobailon/pi-subagents` | `@earendil-works/pi-*` |
| `rpiv-todo` | 1.1.0 | `buihongduc132/rpiv-todo` | `@mariozechner/pi-*` |

## pi-web vs pi-web-access

Ours is ~1,400 source lines and three keyed providers (Exa, Tavily, Firecrawl)
plus raw HTTP. Upstream is 108 top-level files and ~30 search/fetch providers,
including keyless Exa MCP and DuckDuckGo, PDF extraction, YouTube, and GitHub
clone (README lines 7, 23, 39, 58).

Our SSRF guard checks literal hostnames only (`url.ts:78-85`). Upstream
`ssrf-protection.ts` resolves DNS (`validateRemoteUrl`, line ~240), checks every
resolved address against CIDR ranges (`assertPublicAddress`, line ~417), and
revalidates redirect targets (`fetchRemoteUrl`, line ~283).

Our `web_fetch` reads the whole body with `response.text()` (`fetch.ts:120,144`)
and truncates only in the tool output (`tools.ts:415`). Upstream bounds reads in
`fetchRemoteUrl`.

Our provider fallback returns the first provider's result even when it is `[]`
(`selection.ts:85-87`). Upstream documents advancing when a provider returns
empty or off-topic results.

Ours requires an env key; `resolveSearchOrder` drops every keyless provider
(`selection.ts:41-49`). Upstream works with no key by default.

Ours declares `exposure: "codemode"` (`tools.ts:190,325`) while `README.md:3`
says "plain direct tools". That doc/code contradiction is local.

## pi-subagents vs pi-subagents

Ours is ~1,800 source lines plus a string runner shim: one detached Node runner
per child, JSONL Unix socket, `subagent` tool with start/list/status/send/wait/
cancel/resume, and a `subagents:state` event consumed by `pi-todos` and
`pi-statusline`.

Upstream is a 2.5 MB package with foreground in-process children, detached
background runs, fleet/inspector UI, chains/parallel/workflows, seven builtin
agents, cost accounting, watchdog, capability ceilings, and a documented
in-process RPC seam (`docs/extension-api.md`). It emits its own
`subagents:*` events, not our `subagents:state` shape.

Both target `@earendil-works/pi-*`. Upstream has materially more lifecycle
surface: process trees, session leases, async capacity, and terminal receipts.

## pi-todos vs rpiv-todo

Ours: text-block commands (`create_todos`, `complete_todos`, `delete_todos`),
no model tool, combined todos/tasks/subagents panel, custom session entries.
It has no dependency graph and no compaction handler.

Upstream: a schema-validated `todo` tool with pending/in_progress/completed/
deleted transitions, `blockedBy` plus cycle detection, and a 12-line overlay
that drops completed tasks first. It stores snapshots in tool-result details and
replays the branch.

Upstream defects found by reading `todo.ts`:
- `reconstructTodoState` caches the branch on first call and never invalidates
  it (`todo.ts:89-90,576-595`); `session_compact`/`session_tree` therefore replay
  the old branch.
- `detectCycle` merges the current `blockedBy` with the proposed set
  (`todo.ts:146-176`), so removing an edge while adding another can report a
  false cycle. It is only called on `addBlockedBy` (`todo.ts:388`).
- `sessionStates` is unbounded and only cleared by the test-only
  `__resetState` (`todo.ts:83,126-134`).
- README claims priority management (`README.md:7,16`) but no `priority` field
  or handling exists in `todo.ts`/`todo-overlay.ts` (grep: zero matches).

`rpiv-todo` peer-depends on `@mariozechner/pi-*`, while this workspace uses
`@earendil-works/pi-*`; loading it without an alias is a host-compatibility
risk.

## Local feature claims that are not effective

- R56 says `pi-web` adds response caching, rate limiting, and content-type
  negotiation. `fetchUrl` defaults `cacheTtlMs` to 0 (`fetch.ts:215`) and
  `rateLimitMs` is optional (`fetch.ts:179`); `defaultFetch` passes neither
  (`tools.ts:87-91`). Cache and limiter are dead in normal use.
- `pi-todos` README says priority management exists, but priority is only set by
  the `/todo priority` command (`index.ts:483-520`); neither text blocks nor the
  system prompt expose it.
