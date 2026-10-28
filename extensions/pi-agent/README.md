# pi-agent

Agent selection, session forking, and execution profile management for the Pi coding agent.

## Try it

```bash
pi -e ./extensions/pi-agent
```

## Features

- `/agent` — interactive modal selector (`ctx.ui.select`) of available user (`~/.pi/agent/agents/*.md`) and project (`.pi/agents/*.md`) agents.
- `/agent <name>` — activates agent `<name>` directly (with tab completion).
- `/agent default` (or `reset`) — restores the default agent profile.
- **Auto-Forking**: When switching agents in an active conversation, automatically forks the session tree at the current node, labels the fork point (`agent: <name>`), and renames the session to `[<name>] <title>`.
- **Popup Notification**: In TUI mode, displays a modal popup overlay detailing active mode, model, thinking effort, tool loadout, skills, and forked branch name.
- **Skill Filtering**: Strictly filters active skills (`event.systemPromptOptions.skills`) when declared in frontmatter (`skills: author-pr, review`), while preserving all workspace skills if omitted.
- **Tool & Mode Alignment**: Adopts frontmatter `mode` via `@hollowheap/core` `enterMode` and restricts model tools via `pi.setActiveTools(agent.tools)`.
