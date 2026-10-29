# pi-code-intel Review

## Public Seams

- `config.ts:11` / `:20` / `:22` — `ServerConfig`, `CodeIntelExposure`, `CodeIntelConfig`.
- `config.ts:93` — `BUILTIN_SERVERS`.
- `config.ts:341` / `:382` / `:395` / `:402` — `loadCodeIntelConfig`, `findServer`, `missingCommandHint`, `noServerHint`.
- `lsp.ts:12` / `:17` / `:59` — `LspPosition`, `LspClientOptions`, `LspClient`.
- `lsp.ts:547` / `:568` — `getLspClient`, `disposeAllLspClients`.
- `tool.ts:32` / `:52` / `:434` / `:436` — `CodeIntelClient`, `CodeIntelDeps`, `codeIntelTool`, `createCodeIntelTool`.

Note: neither package declares `main`/`exports` in `package.json`, so these are module-level seams.

## Robustness Issues

- `lsp.ts:557-563` — pool eviction deletes and disposes oldest inserted client without usage tracking; active client can be killed.
- `lsp.ts:568-572` — `disposeAllLspClients()` clears pool then awaits disposal; clients inserted during disposal are not disposed.
- `lsp.ts:346-353` — request timeout calls `fail()`, disposing whole client and rejecting all pending requests.
- `lsp.ts:275-334` — spawn-error and early-exit paths can race between `error`/`exit` handlers and `startPromise` rejection.
- `tool.ts:514` / `:519` / `:567` / `:570-573` — file resolution uses `effectiveCwd`, but permissions, LSP `root`, and `FormatContext.root` use `ctx.cwd`.
- `tool.ts:495-502` — runtime does not reject unknown `action` values; they fall through to references branch.
- `tool.ts:553-555` — `deps.loadConfig(...)` runs outside `try` block, so unexpected throw propagates.
- `index.ts:18` / `:33` — `disposeAllLspClients()` promises ignored on session start/shutdown.

## Overengineering

- `config.ts:29-53` / `:332-339` / `:347-360` — global symbol cache, mtime/size cache entries, LRU eviction, reported-diagnostic flags.
- `config.ts:59-206` / `:208-260` — large parsing pipeline with frozen objects and duplicate-extension claim tracking.
- `tool.ts:32-50` / `:106-110` — `CodeIntelClient` and `FormatContext` interfaces add abstraction layer over concrete LSP client.
- `lsp.ts:10` / `:557-563` — 32-entry pool cap and eviction logic for lazily pooled process map.