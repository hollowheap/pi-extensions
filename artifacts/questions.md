# Questions

### Brainstorm — fd/rg duplication

- [x] Q01: Is result-level deny filtering a hard requirement, or does `pi-guard` shell/path policy suffice for `bash` searches?
  - Resolution: D148
- [x] Q02: Does `/cd` still serve built-in file tools and subagent path rewriting after `fd`/`rg` are removed, or should `pi-tools` be retired?
  - Resolution: D148
- [x] Q03: Are shell approvals and unstructured output acceptable for routine search, or do they cost more turns than the 261 tokens saved?
  - Resolution: D148
- [x] Q04: Is `powershell` on Linux (594 bytes) and `ls` (447 bytes) worth keeping in the default active set?
  - Resolution: D153
### Brainstorm — pi-tools after search removal

- [x] Q06: Should `/cd` move into `pi-guard`, remain in a command-only `pi-tools`, or disappear with the search tools?
  - Resolution: D148
- [x] Q07: Which notification events are required: permission/ask, question, completion, error, task completion, subagent completion, or all?
  - Resolution: D157
- [x] Q08: Which platform adapters must ship first: Linux `notify-send`, macOS `osascript`, Windows toast, terminal bell/OSC, or command hook only?
  - Resolution: D158
- [x] Q09: Should notifications include task/subagent text, which may contain sensitive prompts, or only IDs and status?
  - Resolution: D159
- [x] Q10: Is the sandbox requirement specific spawned commands or the entire Pi process? The latter cannot be enforced by the extension.
  - Resolution: D154
- [x] Q11: Does the suite want workspace isolation, or is the current write lock sufficient?
  - Resolution: D160

### Requirements — open questions

- [x] Q12: `pi-web`: adopt `pi-web-access`, wrap it behind a compatibility adapter, or keep the local engine and port only its DNS/CIDR SSRF guard? See `artifacts/brainstorm.md`.
  - Resolution: D155
- [x] Q13: `pi-subagents`: can upstream's RPC/event surface feed `subagents:state` without a fork, or do we harden the local runner first?
  - Resolution: D161
- [x] Q14: `pi-todos`: are text-block commands a product requirement, or should the workspace move to `rpiv-todo`'s `todo` tool once its replay defects are fixed?
  - Resolution: D156
