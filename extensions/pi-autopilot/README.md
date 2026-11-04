# pi-autopilot

Registers the `autopilot` approval mode: reads, edits, shell, and external actions run silently, except calls a `deny` rule or the shell safety list blocks. See the outcome matrix in `pi-guard`'s README for the full `autopilot` column.

Mechanism: this package registers an `autopilot` mode layer on `@hollowheap/core` (allow defaults plus an entry warning). It imports nothing else at runtime and has no extension dependencies.

Composition: `pi-guard` enforces the mode when loaded; `pi-usage` budget caps are optional. Autopilot does not require either package to register the mode.

## Try it

```bash
pi -e ./extensions/pi-guard -e ./extensions/pi-autopilot
```

## Install

```bash
pi install npm:@hollowheap/pi-autopilot
```

Switching to `autopilot` shows a chat warning but never requires a cap. Set an optional dollar cap with `/usage cap $5`; `pi-usage` warns at 80% and aborts the next run at 100%. Without this package `/mode autopilot` is an unknown mode.
