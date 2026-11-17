# pi-agent

Agent selection, session forking, and execution profile management for the Pi coding agent.

## Try it

```bash
pi -e ./extensions/pi-agent
```

## Features

- `/agent` — fuzzy-searchable modal picker of available user (`~/.pi/agent/agents/*.md`) and project (`.pi/agents/*.md`) agents, with a metadata preview. Non-TUI clients fall back to `ctx.ui.select`.
- `/agent <name>` — activates agent `<name>` directly (with tab completion).
- `/agent default` (or `reset`) — restores the default agent profile.
- **Auto-Forking**: When switching agents in an active conversation, automatically forks the session tree at the current node, labels the fork point (`agent: <name>`), and renames the session to `[<name>] <title>`. An unnamed session uses its first user message, falling back to the agent name instead of `session`.
- **Popup Notification**: In TUI mode, displays a modal popup overlay detailing active mode, model, thinking effort, tool loadout, skills, and forked branch name.
- **Terminal Title**: Sets the tab title to `Pi — <agent>` while an agent is active and restores `Pi` for the default agent.
- **Skill Filtering**: Strictly filters active skills (`event.systemPromptOptions.skills`) when declared in frontmatter (`skills: author-pr, review`), while preserving all workspace skills if omitted.
- **Agent Roster**: A frontmatter `agents:` field (comma-separated string or YAML list, e.g. `agents: scout, researcher, worker, code-reviewer`) publishes a short `<agents>` section to the active agent's system prompt. It lists each resolved agent's name and description and shows how to spawn it: `{ action: "start", agent: "<name>", task: "<task>" }` via the `subagent` tool. Unknown names are skipped with a warning. The section is context, not instructions — `sections.agent` is never touched, and an existing non-empty `sections.agents` wins.
- **Frontmatter only**: Agent Markdown bodies are documentation only; profiles do not replace the Pi system prompt.
- **Tool & Mode Alignment**: Adopts frontmatter `mode` via `@hollowheap/core` `enterMode` and restricts model tools via `pi.setActiveTools(agent.tools)`.
