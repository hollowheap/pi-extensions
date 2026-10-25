# pi-budgets

Session token budget for the Pi coding agent: accumulation, `/budget`, and the over-cap gate. Owns its totals and cap, and registers an entry gate on `@hollowheap/core` that refuses `autopilot` without a cap.

## Try it

```bash
pi -e ./extensions/pi-budgets
```

## Install

```bash
pi install npm:@hollowheap/pi-budgets
```

## Budget

`/budget [tokens]` shows or sets the session token budget in whole tokens. After each model response the input and output usage accumulate into a session total (responses without usage are reported and skipped, never estimated). Once the total reaches the cap, further model calls are aborted with a message until `/budget` raises the cap. A cap of 0 or less is rejected. Used and remaining tokens show in the `budget` status text and print on every `/budget` call.

## Statusline values

This package publishes `budgets` (used/remaining tokens) for statusline extensions over pi's shared event bus, following the protocol in `pi-statusline`'s README.
