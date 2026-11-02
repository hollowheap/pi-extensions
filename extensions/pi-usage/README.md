# pi-usage

Records and restores cumulative token counts and dollar cost in session custom entries across context compaction.

## How it works

1. Listens to `message_end` for assistant responses reporting token usage.
2. Calculates dollar cost using the message model's pricing rates, not a model
   selected after the response.
3. Counts input, output, cache-read, and cache-write tokens.
4. Emits `hollowheap.usage` custom entries into the session branch.
5. Restores cumulative totals and budget settings on `session_start` and
   `session_tree`, so compacted history preserves lifetime session usage.

## Commands

- `/usage` — Show cumulative token and dollar usage for the active session.
- `/usage cap $5` — Set a dollar budget cap for the session.
- `/usage cap off` — Clear the session budget cap.

Caps are USD-only. Token caps from the retired `pi-budgets` package are not
carried over.

The report warns at 80% of the cap and blocks the next agent run at 100%.
Messages after a model switch are priced with the model recorded on the
assistant message. The extension emits `statusline:values` under the `usage`
name (`$used/$cap`, empty without a cap) and answers `statusline:request`.
