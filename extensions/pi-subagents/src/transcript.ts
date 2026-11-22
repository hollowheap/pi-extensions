import { readFileSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import {
  AssistantMessageComponent,
  type ExtensionContext,
  type SessionEntry,
  UserMessageComponent,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { hostUi, showDialog } from "@hollowheap/pi-ui/host";
import { pagerSessionDirection } from "@hollowheap/pi-ui/pager";
import { handleViewportKey } from "@hollowheap/pi-ui/viewport";
import { getStatuslineHeight } from "@hollowheap/ui/state";
import { escapeMarkdownInline } from "@hollowheap/ui/thinking";
import { getVisibleWidgetHeight } from "@hollowheap/ui/widget";
import { type SubagentState, subagentDisplayName } from "./state.js";

type MessageEntry = Extract<SessionEntry, { type: "message" }>;

export function formatChildTranscript(jsonl: string, leafId?: string): string {
  const entries = parseSessionEntries(jsonl);
  if (entries[0]?.type !== "session") return "";
  const records = entries.filter(
    (entry): entry is SessionEntry => entry.type !== "session",
  );
  const byId = new Map(records.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  let cursor =
    leafId === undefined
      ? records.at(-1)
      : (byId.get(leafId) ?? records.at(-1));
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

function sessionFile(
  agentDir: string,
  state: SubagentState,
): string | undefined {
  const directory = resolve(agentDir, "subagents");
  const sessionsDirectory = resolve(agentDir, "sessions");
  const file = resolve(
    state.session ?? resolve(directory, `${state.id}.session.jsonl`),
  );
  const inAgentTree = [directory, sessionsDirectory].some((root) =>
    file.startsWith(`${root}${sep}`),
  );
  return inAgentTree && basename(file).endsWith(".jsonl") ? file : undefined;
}

function readSessionTranscript(
  agentDir: string,
  state: SubagentState,
  cache?: Map<string, TranscriptCacheEntry>,
): string | undefined {
  const file = sessionFile(agentDir, state);
  if (file === undefined) return undefined;
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

interface ChatMessage {
  role: string;
  content?: unknown;
  toolName?: string;
}

function messageText(message: ChatMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: { type?: unknown; text?: unknown; name?: unknown }) => {
      if (part.type === "text" && typeof part.text === "string") {
        return [part.text];
      }
      if (part.type === "image") return ["[Image]"];
      if (part.type === "toolCall" && typeof part.name === "string") {
        return [`Tool call: ${part.name}`];
      }
      return [];
    })
    .join("\n\n");
}

function transcriptComponents(
  ctx: ExtensionContext,
  agentDir: string,
  state: SubagentState,
): Array<{ render(width: number): string[] }> {
  const file = sessionFile(agentDir, state);
  if (file === undefined) return [];
  try {
    const theme = hostUi(ctx)?.theme;
    const entries = parseSessionEntries(readFileSync(file, "utf8"));
    return entries
      .filter((entry): entry is MessageEntry => entry.type === "message")
      .filter(
        (entry) =>
          entry.message.role === "user" ||
          entry.message.role === "assistant" ||
          entry.message.role === "toolResult",
      )
      .map((entry) => {
        const message = entry.message as unknown as ChatMessage;
        if (message.role === "user") {
          return new UserMessageComponent(
            sanitizeTerminalText(messageText(message)),
            theme as never,
          );
        }
        if (message.role === "assistant") {
          return new AssistantMessageComponent(
            message as never,
            false,
            theme as never,
          );
        }
        return new Text(
          sanitizeTerminalText(
            `${message.toolName ?? "Tool"}: ${messageText(message)}`,
          ),
          0,
          0,
        );
      });
  } catch {
    return [];
  }
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
  const cache = new Map<string, TranscriptCacheEntry>();
  const read = () => {
    const state = states[index];
    const hostLines = transcriptComponents(ctx, agentDir, state).flatMap(
      (component) => component.render(100).map(stripTerminalSequences),
    );
    return {
      title: `Subagent ${sanitizeTerminalText(subagentDisplayName(state, states))} · Read-only`,
      markdown:
        hostLines.join("\n") ||
        readSessionTranscript(agentDir, state, cache) ||
        sanitizeTerminalText(readLog(state.id)) ||
        "(Waiting for transcript)",
    };
  };
  let terminalRows = 24;
  const overlayOptions = () => {
    const available = Math.max(
      6,
      terminalRows - getVisibleWidgetHeight() - getStatuslineHeight() - 1,
    );
    const contentRows = read().markdown.split("\n").length;
    return {
      width: "100%" as const,
      row: 0,
      col: 0,
      margin: 0,
      maxHeight: Math.min(available, Math.max(6, contentRows)),
    };
  };
  await showDialog<void>(
    ctx,
    (tui, _theme, _keys, done) => {
      terminalRows = tui.terminal.rows;
      let offset = Number.MAX_SAFE_INTEGER;
      let lastLineCount = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        done();
      };
      const pageSize = () => Math.max(1, overlayOptions().maxHeight - 1);
      const maxOffset = () => Math.max(0, lastLineCount - pageSize());
      return {
        capturesViewportInput: true,
        invalidate: () => {},
        render(width: number): string[] {
          const lines = read()
            .markdown.split("\n")
            .flatMap((line) => new Text(line, 0, 0).render(Math.max(1, width)));
          lastLineCount = lines.length;
          offset = Math.min(Math.max(0, offset), maxOffset());
          return lines.slice(offset, offset + pageSize());
        },
        handleInput(data: string): void {
          const direction = pagerSessionDirection(data);
          if (direction !== undefined && states.length > 1) {
            index = (index + direction + states.length) % states.length;
            offset = Number.MAX_SAFE_INTEGER;
            tui.requestRender();
            return;
          }
          handleViewportKey(data, {
            onClose: finish,
            onScrollBy: (delta) => {
              offset += delta;
              tui.requestRender();
            },
            onScrollTo: (next) => {
              offset = next;
              tui.requestRender();
            },
            pageSize,
            maxOffset,
            pagerKeys: true,
          });
        },
        dispose: finish,
      };
    },
    {
      overlay: true,
      overlayOptions,
    },
  );
}
