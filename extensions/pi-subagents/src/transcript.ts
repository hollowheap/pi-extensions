import { readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  type ExtensionContext,
  type SessionEntry,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { showMarkdownPager } from "@hollowheap/pi-ui/pager";
import { escapeMarkdownInline } from "@hollowheap/ui/thinking";
import { type SubagentState, subagentDisplayName } from "./state.js";

export function formatChildTranscript(jsonl: string): string {
  const entries = parseSessionEntries(jsonl);
  if (entries[0]?.type !== "session") return "";
  const records = entries.filter(
    (entry): entry is SessionEntry => entry.type !== "session",
  );
  const byId = new Map(records.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  let cursor = records.at(-1);
  while (cursor && byId.delete(cursor.id)) {
    branch.push(cursor);
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  const rendered: string[] = [];
  for (const entry of branch.reverse()) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (
      message.role !== "user" &&
      message.role !== "assistant" &&
      message.role !== "toolResult"
    )
      continue;
    const heading =
      message.role === "user"
        ? "User"
        : message.role === "assistant"
          ? "Assistant"
          : `Tool · ${escapeMarkdownInline(sanitizeTerminalText(message.toolName))}`;
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .flatMap((part) => {
              if (part.type === "text") return [part.text];
              if (part.type === "image") return ["[Image]"];
              if (part.type === "toolCall") {
                const name = escapeMarkdownInline(
                  sanitizeTerminalText(part.name),
                );
                const args = JSON.stringify(part.arguments, null, 2);
                return [
                  `**Tool call · ${name}**\n\n${"\x60".repeat(3)}json\n${args}\n${"\x60".repeat(3)}`,
                ];
              }
              return [];
            })
            .join("\n\n");
    if (text.trim())
      rendered.push(`## ${heading}\n\n${sanitizeTerminalText(text)}`);
  }
  return rendered.join("\n\n");
}

interface TranscriptCacheEntry {
  signature: string;
  markdown: string;
}

function readSessionTranscript(
  agentDir: string,
  state: SubagentState,
  cache?: Map<string, TranscriptCacheEntry>,
): string | undefined {
  const directory = resolve(agentDir, "subagents");
  const file = resolve(
    state.session ?? resolve(directory, `${state.id}.session.jsonl`),
  );
  if (dirname(file) !== directory || !basename(file).endsWith(".session.jsonl"))
    return undefined;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return undefined;
    const signature = `${stat.mtimeMs}:${stat.size}`;
    const cached = cache?.get(file);
    if (cached?.signature === signature) return cached.markdown;
    const markdown = formatChildTranscript(readFileSync(file, "utf8"));
    cache?.set(file, { signature, markdown });
    return markdown;
  } catch {
    // A starting child may not have written a complete transcript yet.
  }
  return undefined;
}

function formatSessionBranch(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager?.getBranch?.() ?? [];
  const lines = ["# Session tree", ""];
  for (const entry of entries) {
    const record = entry as {
      type?: unknown;
      id?: unknown;
      timestamp?: unknown;
      message?: unknown;
    };
    const type = sanitizeTerminalText(String(record.type ?? "entry"));
    const id = sanitizeTerminalText(String(record.id ?? ""));
    const message = record.message as { role?: unknown; content?: unknown };
    let detail = "";
    if (message && typeof message === "object") {
      const role = sanitizeTerminalText(String(message.role ?? ""));
      const blocks = Array.isArray(message.content) ? message.content : [];
      const text = blocks
        .map((block) =>
          block && typeof block === "object"
            ? String((block as { text?: unknown }).text ?? "")
            : "",
        )
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 80);
      detail = `${role} ${text}`.trim();
    }
    lines.push(
      `- **${escapeMarkdownInline(type)}** \`${escapeMarkdownInline(id)}\`${detail ? ` — ${escapeMarkdownInline(sanitizeTerminalText(detail))}` : ""}`,
    );
  }
  if (entries.length === 0) lines.push("(empty branch)");
  return lines.join("\n");
}

export async function showSubagentTranscript(
  ctx: ExtensionContext,
  agentDir: string,
  states: readonly SubagentState[],
  initialId: string,
  readLog: (id: string) => string,
): Promise<void> {
  let index = states.findIndex(({ id }) => id === initialId);
  if (index < 0) return;
  let showBranch = false;
  const cache = new Map<string, TranscriptCacheEntry>();
  const read = () => {
    if (showBranch) {
      return { title: "Session tree", markdown: formatSessionBranch(ctx) };
    }
    const state = states[index];
    return {
      title: `Subagent ${sanitizeTerminalText(subagentDisplayName(state))} · Read-only`,
      markdown:
        readSessionTranscript(agentDir, state, cache) ||
        sanitizeTerminalText(readLog(state.id)) ||
        "(Waiting for transcript)",
    };
  };
  await showMarkdownPager(ctx, {
    ...read(),
    fullscreen: true,
    read,
    onAlternateView: () => {
      showBranch = !showBranch;
    },
    navigate:
      states.length > 1
        ? (direction) => {
            index = (index + direction + states.length) % states.length;
          }
        : undefined,
  });
}
