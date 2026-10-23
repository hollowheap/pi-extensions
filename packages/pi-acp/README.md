# pi-acp

ACP adapter letting ACP clients (e.g. Neovim Avante) drive pi. A stdio JSON-RPC 2.0 server with one runtime dependency (`@hollowheap/core`): one `pi --mode rpc` process per ACP session, plus a bundled pi extension (`src/extension/`) for the `acp_*` tools.

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
- `src/extension/` — bundled extension loaded via `pi -e`. Ships `acp_read/acp_write/acp_edit/acp_bash/acp_fd/acp_rg/acp_eza` plus a hook governing pi's built-in tools, and it evaluates verdicts through `@hollowheap/core` (the same policy the TUI extension uses).
- `src/socket.ts` — newline-JSON wire between extension and adapter (request ids, per-side pending maps). Socket path travels in `HOLLOWHEAP_ACP_SOCKET`; client capabilities in `HOLLOWHEAP_ACP_CAPS`.
- pi spawns as `pi --mode rpc -ne -e <bundled> -nbt --append-system-prompt ...`. `-nbt` disables pi's built-in tools, so `read`/`write`/`edit`/`bash` cannot run behind the client's back; the prompt appendix steers the model to the `acp_*` tools.

The extension depends on `@hollowheap/core` (`dependencies`, `^0.2.0`); the adapter and the extension share the core mode registry, so a mode set over the socket is the same mode the client sees.

## Notes

- `fs/*` and `terminal/*` requests time out after 10 seconds. Terminal commands run to completion via `terminal/output` polling, never `wait_for_exit`, and the polling loop is bounded by a wall-clock deadline.
- Permissions offer exactly `allow_once` / `reject_once` through `session/request_permission`, carrying the real pi tool-call id; denied calls never reach the client. Without a connected client, an `ask` verdict resolves to a block.
- The active mode is pushed to the extension on every connect and reconnect; a mode change requested before the handshake completes is buffered and applied on connect.
- The adapter asks the extension for the mode list (`get-modes` over the socket) and offers every registered mode to the client, so a mode contributed by an extension (`autopilot`) is selectable. A mode notice rides in the returned mode config option's description, so the client renders it without a separate channel.
- `session/load` replays `get_messages` history as updates. Model usage is not reported (out of scope).
- `eza`, `fd`, and `rg` binaries must be installed for those tools; otherwise they fail with a clear error.
