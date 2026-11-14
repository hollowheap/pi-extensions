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

### Review V19–V38 — workspace re-review (robust)

- [x] Q15: Where does destructive-shell analysis live: a core `ask` set in `packages/core/src/shell.ts`, or per-mode overrides? Autopilot allows `rm -rf ~` and `git push --force` today.
  - Scope: V22-F3, V38-F2. Blocks: autopilot and allow-prefix shell fixes.
  - Resolution: D181
- [x] Q16: Which cost source is authoritative for caps and reports: provider `usage.cost.total` or the local price table? Must decide whether classifier and observer spend counts toward the cap.
  - Scope: V33-F3, V35-F1/F3, V22-F6. Blocks: one shared cost function.
  - Resolution: D178
- [x] Q17: Must every overlay prompt take an abort signal and a timeout, so the shared prompt lock can never hang?
  - Scope: V20-F1, V22-F4/F5, V36-F8/F9. Blocks: prompt-lock and dialog fixes.
  - Resolution: D177
- [x] Q18: Must a settings save refuse to overwrite a config file that does not parse?
  - Scope: V25-F3, V27-F3, V29-F6, V34-F7. Blocks: config save fixes in four extensions.
  - Resolution: D179

### Brainstorm — review remediation

- [x] Q19: In which order must fixes land: highs per slice first, contracts first, or the severity-gated hybrid in `artifacts/brainstorm.md`?
  - Scope: V19–V38. Blocks: plan ordering.
  - Resolution: D176
- [x] Q20: How do the plain-`node` shims (`extensions/pi-subagents/runner-shim.mjs`, `extensions/pi-tasks/src/shim.cjs`) get a process-tree kill? The options are a copied JS twin, a built runtime artifact, or running the shims under jiti.
  - Scope: V21-F2, V24-F1, V31-F2. Blocks: `killTree` extraction.
  - Resolution: D183
- [x] Q21: Must `sanitizeTerminalText` keep SGR color codes from trusted sources, or strip all escape sequences everywhere?
  - Scope: V29-F3, V30-F12, V31-F5, V34-F10, V36-F3. Blocks: sanitize extraction.
  - Resolution: D182
- [x] Q22: What precedence order must permission checks follow? The inputs are hard deny, persistent deny, session allow, trusted root, mode default, and the read/write tag.
  - Scope: V22-F1/F2, V29-F1/F2/F4. Blocks: permission-core fixes.
  - Resolution: D180
- [x] Q23: Must a breaking change to the `withPromptLock` signature land in one commit across 8 consumers, or must the change be additive with optional `signal` and `timeoutMs`?
  - Scope: V20-F1, V22-F4/F5. Blocks: prompt-lock extraction.
  - Resolution: D177

### Plan — hooks

- [x] Q24: Should a relative hook command resolve against the directory of the config file that declared it (D184), and should a relative command from a trusted project resolve against the project root?
  - Scope: S181, D184. Blocks: S181 tasks (not yet planned). Malformed-condition fail-closed is planned under S34 (T179).
  - Resolution: D184

### Plan — pi-question

- [x] Q25: When a question flow is cancelled, should the model receive a cancelled message with any partial answers, or nothing?
  - Scope: V36-F2. Blocks: cancel-path behavior; no spec exists yet.
  - Resolution: D185

### Plan — pi-decide

- [x] Q26: Should pi-decide write its billed classifier calls to the shared usage ledger through pi-usage's snapshot persistence, or through a dedicated usage entry?
  - Scope: S182, V35-F1/F3. Blocks: T163.
  - Resolution: D178
