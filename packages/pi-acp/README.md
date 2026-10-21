# pi-acp

ACP adapter letting ACP clients (e.g. Neovim Avante) drive pi. A stdio JSON-RPC 2.0 server with no dependencies: one `pi --mode rpc` process per ACP session, plus a bundled pi extension (`src/extension/`) for tools, modes, and permissions.

This package is not a pi extension itself — do not load it with `pi -e`. Build it, then point the client at the bundle:

```bash
npx tsc -p packages/pi-acp
```

## Avante

```lua
require("avante").setup({
  acp_providers = {
    ["pi"] = {
      command = "node",
      args = { "/home/hollowheap/repos/my-pi-agent/packages/pi-acp/dist/main.js" },
      env = {},
    },
  },
})
```

Then `:AvanteSwitchProvider` and pick `pi`.

## How it works

- `src/main.ts` — stdio entry: JSON-RPC dispatch, agent→client requests, session/update notifications. Logs go to stderr; stdout carries only ACP.
- `src/adapter.ts` — sessions (spawn, list, load, cancel, mode config), backed by a JSON store (`~/.local/share/hollowheap-pi-acp/sessions.json`, overridable with `HOLLOWHEAP_ACP_HOME`).
- `src/extension/` — bundled extension loaded via `pi -e`. Ships `acp_read/acp_write/acp_edit/acp_bash/acp_fd/acp_rg/acp_eza` plus a hook governing pi's built-in tools, modes `plan`/`ask`/`edit` (session memory), and the rules + bash gate.
- `src/socket.ts` — newline-JSON wire between extension and adapter (request ids, per-side pending maps). Socket path travels in `HOLLOWHEAP_ACP_SOCKET`; client capabilities in `HOLLOWHEAP_ACP_CAPS`.
- pi spawns as `pi --mode rpc -ne -e <bundled> --append-system-prompt ...`. Built-ins stay enabled; the prompt appendix steers the model to the `acp_*` tools.

The extension vendors byte-identical copies of `pi-guard`'s `rules.ts`/`loader.ts`/`bash.ts` and `pi-tools`' `exec.ts` (those packages hold the canonical copies — edit there, then copy over). The loader resolves only host modules and intra-package files, so shared code cannot be imported at runtime.

## Notes

- `fs/*` and `terminal/*` requests time out after 10 seconds. Terminal commands run to completion via `terminal/output` polling, never `wait_for_exit`.
- Permissions offer exactly `allow_once` / `reject_once` through `session/request_permission`; denied calls never reach the client. Bash runs when every part is allowlisted; otherwise it asks the client in `ask` and is blocked in `edit`/`plan`. Without a connected client, unallowlisted parts are blocked.
- `session/load` replays `get_messages` history as updates. Model usage is not reported (out of scope).
- `eza`, `fd`, and `rg` binaries must be installed for those tools; otherwise they fail with a clear error.
