# pi-usage

Records and restores cumulative token counts and dollar cost in session custom entries across context compaction.

## How it works

1. Listens to `message_end` for assistant responses reporting token usage.
2. Calculates dollar cost using the model's pricing rates.
3. Emits `hollowheap.usage` custom entries into the session branch.
4. Restores cumulative totals on `session_start` and `session_tree` so compacted history preserves lifetime session usage.

## Commands

- `/usage` — Show cumulative token and dollar usage for the active session.
