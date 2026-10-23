# pi-code-intel

Read-only code intelligence for the Pi coding agent. One `code_intel` tool
queries the project's language server for definitions, references, document
symbols, and workspace symbols. It registers no UI, command, or edit tool.

## Try it

```bash
pi -e ./packages/pi-code-intel
```

## Install

```bash
pi install npm:@hollowheap/pi-code-intel
```

## Codemode exposure

`code_intel` registers with `exposure: "codemode"`, so scripts call it as
`tools.code_intel({ ... })` instead of seeing it in the direct tool schema. On
`session_start`, the extension activates the registered `codemode` tool when it
is available and inactive. If `codemode` is disabled or unavailable, `code_intel`
is unreachable. `/reload` re-activates `codemode` if it was deactivated.

## Actions

`path` is required for every action and selects the language server. `line` and
`column` are 1-based editor coordinates; the client converts them to 0-based LSP
positions.

| Action | Required fields | Output |
| :--- | :--- | :--- |
| `definition` | `path`, `line`, `column` | One `path:line:column` per location |
| `references` | `path`, `line`, `column` | One `path:line:column` per location |
| `document_symbols` | `path` | Indented `name (kind) path:line` outline |
| `workspace_symbols` | `path`, `query` | `path:line:column name (kind) [container]` |

`workspace_symbols` is workspace-wide for the selected server; `path` chooses
which configured server answers. `max_results` defaults to 100 and is capped at
500. When more results are available, the output ends with
`... (truncated)`.

Empty results return `No definitions found.`, `No references found.`,
`No symbols found.`, or `No workspace symbols found.`. Validation errors,
denied paths, an untrusted project, a missing server, a timeout, or a server
failure return explanatory text instead of throwing.

## Built-in servers

| Name | Command | Extensions |
| :--- | :--- | :--- |
| `typescript` | `typescript-language-server --stdio` | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` |
| `python` | `pyright-langserver --stdio` | `.py`, `.pyi` |
| `rust` | `rust-analyzer` | `.rs` |
| `go` | `gopls` | `.go` |
| `clangd` | `clangd` | `.c`, `.h`, `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh` |
| `lua` | `lua-language-server` | `.lua` |

The commands must already be installed and on `PATH`. The extension never
auto-installs a server or resolves one from `node_modules`. A missing command
returns a setup hint with the expected command and config path.

## Configuration

Create `<agentDir>/code-intel.json` to override a built-in server by name or add
a new server:

```json
{
  "servers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": {
        ".ts": "typescript",
        ".tsx": "typescriptreact"
      },
      "timeoutMs": 10000
    },
    "custom": {
      "command": "custom-language-server",
      "args": ["--stdio"],
      "extensions": { ".custom": "custom" }
    }
  }
}
```

- `command`: non-empty string executed without a shell.
- `args`: optional string array.
- `extensions`: non-empty suffix-to-language-id object. Each key starts with `.`.
- `timeoutMs`: optional positive integer, default `10000`, maximum `60000`.

User servers replace built-ins with the same name. New user servers are matched
before built-ins, and the first server claiming a suffix wins. A duplicate
suffix across user servers is diagnosed; the later claim is ignored. Malformed
entries are dropped with one `ctx.ui.notify` diagnostic per file change. There
is no project-level server config.

## Trust, safety, and cleanup

- **Trust gate:** `code_intel` requires `ctx.isProjectTrusted()`. In an untrusted
  project it returns a trust message and starts no server. A language server
  runs with your user permissions and may read more files than the tool returns;
  project trust plus result filtering is the boundary.
- **Read-only:** the extension sends navigation requests only. It never sends
  edits, rename, formatting, or code-action requests, and registers no tool that
  mutates files.
- **Permissions:** the target path and every returned location are checked with
  core `checkPath(..., "read", ctx.cwd)`. A `deny` drops the location; `ask` is
  treated as allowed, matching `pi-tools`. Returned paths outside the workspace
  and non-`file:` URIs are dropped; the target path itself must pass the same
  read check.
- **Timeouts:** requests default to 10 seconds. A server `timeoutMs` can lower or
  raise it up to 60 seconds. A timeout or protocol failure kills that server,
  rejects pending work, and removes it from the pool; the next query may
  respawn it.
- **Crash handling:** server stderr is captured in a bounded buffer for error
  text and is not printed. A server exit rejects pending requests and removes
  the pool entry.
- **Cleanup:** on `session_start`, stale servers are disposed. On
  `session_shutdown`, every server receives `shutdown`/`exit` and is then killed
  best-effort without blocking the session.

Servers are pooled lazily per command, arguments, and workspace root, and are
reused across queries. Files are synchronized from disk with full-text
`didOpen`/`didChange` before position and document-symbol queries.
