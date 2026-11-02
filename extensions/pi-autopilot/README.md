# pi-autopilot

Registers the `autopilot` approval mode for `pi-guard`: reads, edits, and shell run silently, except calls a `deny` rule or the bash safety list blocks. See the outcome matrix in `pi-guard`'s README for the full `autopilot` column.

Mechanism: this package registers an `autopilot` mode layer on `@hollowheap/core` (allow defaults plus an entry warning). It imports nothing else at runtime.

Composition: `pi-guard` is a declared dependency for tool approvals and core shell safety. Budget caps are optional and live in `pi-usage`; autopilot does not require one to enter.

## Try it

```bash
pi -e ./extensions/pi-guard -e ./extensions/pi-usage -e ./extensions/pi-autopilot
```

## Install

```bash
pi install npm:@hollowheap/pi-autopilot
```

Switching to `autopilot` shows a chat warning but never requires a cap. Set an optional dollar cap with `/usage cap $5`; `pi-usage` warns at 80% and aborts the next run at 100%. Without this package `/mode autopilot` is an unknown mode.
