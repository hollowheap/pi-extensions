import { readFileSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import {
  AssistantMessageComponent,
  type ExtensionContext,
  type FileEntry,
  type Theme,
  UserMessageComponent,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Key,
  ScrollView,
  Text,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { hostUi, showDialog } from "@hollowheap/pi-ui/host";
import { pagerSessionDirection } from "@hollowheap/pi-ui/pager";
import { handleViewportKey } from "@hollowheap/pi-ui/viewport";
import { getSharedHeader } from "@hollowheap/ui/header";
import { escapeMarkdownInline } from "@hollowheap/ui/thinking";
import type { SubagentState } from "./state.js";

type MessageEntry = Extract<FileEntry, { type: "message" }>;
type BranchEntry = Exclude<FileEntry, { type: "session" }>;

function activeBranch(
  entries: readonly FileEntry[],
  leafId?: string,
): BranchEntry[] {
  if (entries[0]?.type !== "session") return [];
  const records = entries.filter(
    (entry): entry is BranchEntry => entry.type !== "session",
  );
  const byId = new Map(records.map((entry) => [entry.id, entry]));
  const branch: BranchEntry[] = [];
  let cursor =
    leafId === undefined
      ? records.at(-1)
      : (byId.get(leafId) ?? records.at(-1));
  while (cursor && byId.delete(cursor.id)) {
    branch.push(cursor);
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return branch.reverse();
}

export function formatChildTranscript(jsonl: string, leafId?: string): string {
  const entries = parseSessionEntries(jsonl);
  const branch = activeBranch(entries, leafId);
  const rendered: string[] = [];
  for (const entry of branch) {
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

function transcriptDocument(
  ctx: ExtensionContext,
  agentDir: string,
  state: SubagentState,
  theme: Theme,
  fallback: string,
): Component {
  const fallbackComponent: Component = {
    render: (width) =>
      fallback
        .split("\n")
        .flatMap((line) => new Text(line, 0, 0).render(Math.max(1, width))),
    invalidate() {},
  };
  const file = sessionFile(agentDir, state);
  if (file === undefined) return fallbackComponent;
  let signature: string | undefined;
  let components: Component[] = [];
  const refresh = (): boolean => {
    try {
      const stat = statSync(file);
      if (!stat.isFile()) return false;
      const nextSignature = `${stat.mtimeMs}:${stat.size}`;
      if (nextSignature === signature) return components.length > 0;
      const hostTheme = hostUi(ctx)?.theme ?? theme;
      const entries = parseSessionEntries(readFileSync(file, "utf8"));
      components = activeBranch(entries)
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
              hostTheme as never,
            );
          }
          if (message.role === "assistant") {
            return new AssistantMessageComponent(
              message as never,
              false,
              hostTheme as never,
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
      signature = nextSignature;
      return components.length > 0;
    } catch {
      return false;
    }
  };
  return {
    render: (width) => {
      if (!refresh()) return fallbackComponent.render(width);
      return components.flatMap((component) =>
        component.render(Math.max(1, width)),
      );
    },
    invalidate() {
      for (const component of components) component.invalidate?.();
    },
  };
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
  const fallback = () => {
    const state = states[index];
    return (
      readSessionTranscript(agentDir, state, cache) ||
      sanitizeTerminalText(readLog(state.id)) ||
      "(Waiting for transcript)"
    );
  };
  let terminalRows = 24;
  const overlayOptions = () => ({
    width: "100%" as const,
    row: 0,
    col: 0,
    margin: 0,
    maxHeight: "100%" as const,
  });
  await showDialog<void>(
    ctx,
    (tui, theme, _keys, done) => {
      terminalRows = tui.terminal.rows;
      let settled = false;
      let contentHeight = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        done();
      };
      const pageSize = () => Math.max(1, terminalRows);
      let bodyRows = 1;
      const maxOffset = () => Math.max(0, contentHeight - bodyRows);
      const createViewer = () =>
        new ScrollView(
          transcriptDocument(ctx, agentDir, states[index], theme, fallback()),
          {
            follow: "end",
            primary: true,
            overscroll: "chain",
            scrollbar: "hidden",
          },
        );
      let viewer = createViewer();
      return {
        capturesViewportInput: true,
        invalidate: () => {
          viewer.invalidate?.();
          tui.requestRender();
        },
        render(width: number): string[] {
          const headerLines = (
            getSharedHeader()?.render(width, theme) ?? []
          ).slice(0, Math.max(0, pageSize() - 1));
          bodyRows = Math.max(1, pageSize() - headerLines.length);
          const lines = viewer.render(width);
          contentHeight = lines.length;
          viewer.updateLayout(contentHeight, bodyRows, () =>
            tui.requestRender(),
          );
          const visible = lines
            .slice(viewer.scrollTop, viewer.scrollTop + bodyRows)
            .map((line) => truncateToWidth(line, Math.max(1, width), "", true));
          while (visible.length < bodyRows) visible.push("");
          return [...headerLines, ...visible];
        },
        handleInput(data: string): void {
          const direction = pagerSessionDirection(data);
          if (
            direction !== undefined &&
            (matchesKey(data, Key.alt("left")) ||
              matchesKey(data, Key.alt("right")))
          ) {
            const next = index + direction;
            if (next < 0 || next >= states.length) {
              finish();
              return;
            }
            index = next;
            viewer = createViewer();
            tui.requestRender();
            return;
          }
          if (direction !== undefined && states.length > 1) {
            const next = (index + direction + states.length) % states.length;
            if (next === index) return;
            index = next;
            viewer = createViewer();
            tui.requestRender();
            return;
          }
          handleViewportKey(data, {
            onClose: finish,
            onScrollBy: (delta) => {
              viewer.scrollBy(delta);
              tui.requestRender();
            },
            onScrollTo: (next) => {
              viewer.scrollTo(next, { disableFollow: true });
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
