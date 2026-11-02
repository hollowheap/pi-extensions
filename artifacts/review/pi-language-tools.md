# Review — pi-language-tools (V07)

## Scope

- Requirements: `artifacts/requirements.md`
- Decisions: `artifacts/decisions.md`
- Specs: `artifacts/specs.md`
- Tasks: `artifacts/plan.md`


## Requirements Review

N/A — package robustness review; traceability is recorded in the Code Review findings.

## Design Review

N/A — package robustness review; see `artifacts/architecture.md`.

## Specification Review

N/A — package robustness review; verify commands are recorded under Code Review.

## Plan Review

N/A — package robustness review; tasks remain in `artifacts/plan.md`.

## Code Review

### Public Seams

- `config.ts:11` / `:20` — `ServerConfig`, `LanguageToolsConfig`.
- `config.ts:76` — `BUILTIN_SERVERS`.
- `config.ts:298` / `:331` / `:344` / `:351` — `loadLanguageToolsConfig`, `findServer`, `missingCommandHint`, `noServerHint`.
- `lsp.ts:12` / `:17` / `:65` — `LspPosition`, `LspClientOptions`, `LspClient`.
- `lsp.ts:706` / `:732` — `getLspClient`, `disposeAllLspClients`.
- `tool.ts:31` / `:72` / `:607` / `:609` — `LangClient`, `LangToolDeps`, `langTool`, `createLangTool`.

Note: neither package declares `main`/`exports` in `package.json`, so these are module-level seams.

### Robustness Issues

- `lsp.ts:557-563` — pool eviction deletes and disposes oldest inserted client without usage tracking; active client can be killed.
- `lsp.ts:568-572` — `disposeAllLspClients()` clears pool then awaits disposal; clients inserted during disposal are not disposed.
- `lsp.ts:346-353` — request timeout calls `fail()`, disposing whole client and rejecting all pending requests.
- `lsp.ts:275-334` — spawn-error and early-exit paths can race between `error`/`exit` handlers and `startPromise` rejection.
- `tool.ts:514` / `:519` / `:567` / `:570-573` — file resolution uses `effectiveCwd`, but permissions, LSP `root`, and `FormatContext.root` use `ctx.cwd`.
- `tool.ts:495-502` — runtime does not reject unknown `action` values; they fall through to references branch.
- `tool.ts:553-555` — `deps.loadConfig(...)` runs outside `try` block, so unexpected throw propagates.
- `index.ts:18` / `:33` — `disposeAllLspClients()` promises ignored on session start/shutdown.

### Overengineering Audit (2026-10-29)

Each original item is checked against `artifacts/requirements.md` and
`artifacts/decisions.md`.

| Item | Requirement link | Verdict |
| --- | --- | --- |
| `config.ts:29-53` / `:332-339` / `:347-360` — global symbol cache, mtime/size entries, LRU eviction, reported-diagnostic flags. | R08, R19, D05, D63 | **Required behavior, duplicated implementation.** D05 requires mtime-cached JSON config with once-per-change diagnostics, and R08 says every consumer uses the shared core primitive. This is not overengineering; it is a second cache that should move to or use core. The 16-entry LRU is a local bound, not separately required. |
| `config.ts:59-206` / `:208-260` — large parsing pipeline, frozen objects, duplicate-extension claim tracking. | R19, D63 | **Required, not overengineering.** D63 requires built-in servers overlaid by `language-tools.json`, and duplicate extension claims decide which server owns a suffix. The frozen objects are implementation detail, not a separate feature. |
| `tool.ts:32-50` / `:106-110` — `LangClient` and `FormatContext` interfaces over the concrete LSP client. | No R/D | **Overengineered.** `LangClient` is a test double seam with one concrete consumer; `FormatContext` is internal parameter plumbing. Neither is a requirement, and both add indirection over `LspClient`. |
| `lsp.ts:10` / `:557-563` — 32-entry pool cap and eviction logic. | R19 | **Required, not overengineering.** R19 requires pooled LSP servers, and a process pool needs a bound. The defect is the eviction policy (active client can be disposed), not the existence of a cap. |

### Resolution (2026-10-30)

- Pool hits refresh LRU order; eviction skips busy clients and only disposes the least-recently-used idle client.
- `disposeAllLspClients()` drains the pool in a loop so clients inserted during disposal are included.
- A request timeout rejects only that request and sends `$/cancelRequest`; it no longer disposes the shared client.
- Startup rejection is wired through `startReject`, so spawn errors, early exits, and disposal during startup settle the initialization promise.
- Unknown runtime actions return explanatory text instead of falling through to references.
- `loadConfig` failures are caught and returned as text.
- Session-start/shutdown disposal promises handle rejection instead of becoming unhandled.
- `effectiveCwd` remains the display/run cwd while `ctx.cwd` remains the workspace boundary and LSP root, matching `pi-tools`.
- `LangClient` and `FormatContext` remain internal seams.
- Config caching now uses the core `MtimeCache`; the LSP client pool remains package-local because it owns process lifecycle.
- `lang` is codemode-only: the exposure override was removed, the tool always registers as `codemode`, and the extension always activates codemode when available.
- Added read-only `signature_help`, `type_definition`, `implementation`, `document_highlights`, and `diagnostics` actions. Diagnostics use pull or push LSP support; no formatting, rename, or code-action edits were added.

## Acceptance Review

N/A — package robustness review; end-to-end verification is recorded under Code Review > Verification when present.

## Findings

See the Code Review subsections above. Existing findings and resolutions are preserved.

## Verdict

Accepted — existing review record; formatting only.
