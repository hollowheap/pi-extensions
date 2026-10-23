# pi-autopilot

Registers the `autopilot` approval mode for `pi-guard`: reads, edits, and shell run silently, except calls a `deny` rule or the bash safety list blocks. See the outcome matrix in `pi-guard`'s README for the full `autopilot` column.

Mechanism: this package registers an `autopilot` mode layer on `@hollowheap/core` (allow defaults plus an entry warning). It imports nothing else at runtime.

## Try it

```bash
pi -e ./packages/pi-guard -e ./packages/pi-autopilot
```

## Install

```bash
pi install npm:@hollowheap/pi-autopilot
```

Switching to `autopilot` without a token cap (`/budget`, from `pi-budgets`) is refused, and turning it on shows a chat warning. Without this package `/mode autopilot` is an unknown mode.
