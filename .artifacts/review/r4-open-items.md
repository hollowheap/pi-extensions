# R4 open items valid to current requirements

Verified against current source at `b880c22`. Items marked FIXED, SUPERSEDED,
NON-GOAL, or ACCEPTED-DEBT in the r4 reconciliation are excluded. Only gaps
that are unfixed and mapped to a live requirement are listed.

| ID | Source | Gap | Requirement |
| --- | --- | --- | --- |
| O01 | `packages/core/src/shell.ts:52-62` | Quoted shell tokens are not dequoted, so `'rm'` and wrapper forms bypass the dangerous-command list. | R82 |
| O02 | `packages/core/src/shell.ts:155-171` | Destructive-target detection covers only root/home; `rm -rf /etc` is allowed in auto mode. | R82 |
| O03 | `packages/core/src/format.ts:101-108` | `id.includes(key)` pricing lookup can match unrelated model ids as free. | R88 |
| O04 | `packages/core/src/pricing.ts:131-138` | Cache token counts are checked by truthiness only, not finite/non-negative. | R88 |
| O05 | `packages/core/src/prompt-lock.ts:107-123` | `release()` runs on abort while a holder is active, allowing a second prompt to overlap. | R87 |
| O06 | `packages/runtime/src/process.ts:79-83` | `isProcessAlive` fails open when process start time is unreadable. | R86 |
| O07 | `packages/runtime/src/process.ts:177` | `kill(-pid)` has no generation check, so a reused PGID can be signalled. | R86 |
| O08 | `extensions/pi-btw/src/index.ts:96` | The side-question input dialog does not acquire the prompt lock. | R87 |
| O09 | `packages/policy/src/targets.ts:30-37` | `PASSTHROUGH_ACTIONS` still includes `delete` and `cancel`, which can bypass task gating. | R112 |
| O10 | `extensions/pi-agent/src/index.ts:257` | Fork re-captures restricted tools as the base active set, re-exposing codemode tools. | R16 |

Non-goals and accepted debt from r4 remain in `ARCHITECTURE.md` and are not
reopened here. The original r4 review texts were overwritten by the later seam
reviews and are not recoverable from git.
