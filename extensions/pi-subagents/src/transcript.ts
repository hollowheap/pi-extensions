import { readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  type ExtensionContext,
  type SessionEntry,
  SessionManager,
  TreeSelectorComponent,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { showDialog } from "@hollowheap/pi-ui/host";
import { showMarkdownPager } from "@hollowheap/pi-ui/pager";
import { escapeMarkdownInline } from "@hollowheap/ui/thinking";
import { type SubagentState, subagentDisplayName } from "./state.js";

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

function readSessionTranscript(
  agentDir: string,
  state: SubagentState,
  cache?: Map<string, TranscriptCacheEntry>,
  leafId?: string,
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
    const signature = `${stat.mtimeMs}:${stat.size}:${leafId ?? ""}`;
    const cached = cache?.get(file);
    if (cached?.signature === signature) return cached.markdown;
    const markdown = formatChildTranscript(readFileSync(file, "utf8"), leafId);
    cache?.set(file, { signature, markdown });
    return markdown;
  } catch {
    // A starting child may not have written a complete transcript yet.
  }
  return undefined;
}

async function selectTranscriptEntry(
  ctx: ExtensionContext,
  agentDir: string,
  state: SubagentState,
): Promise<string | undefined> {
  const directory = resolve(agentDir, "subagents");
  const file = resolve(
    state.session ?? resolve(directory, `${state.id}.session.jsonl`),
  );
  if (
    dirname(file) !== directory ||
    !basename(file).endsWith(".session.jsonl")
  ) {
    return undefined;
  }
  try {
    const tree = SessionManager.open(file).getTree();
    if (tree.length === 0) return undefined;
    return await showDialog<string | undefined>(
      ctx,
      (_tui, _theme, _keys, done) =>
        new TreeSelectorComponent(
          tree,
          null,
          20,
          (entryId) => done(entryId),
          () => done(undefined),
        ),
      {
        overlay: true,
        overlayOptions: { width: "70%", maxHeight: "75%", margin: 1 },
      },
    );
  } catch {
    return undefined;
  }
}

export async function showSubagentTranscript(
  ctx: ExtensionContext,
  agentDir: string,
  states: readonly SubagentState[],
  initialId: string,
  readLog: (id: string) => string,
  options: { openTree?: boolean } = {},
): Promise<void> {
  let index = states.findIndex(({ id }) => id === initialId);
  if (index < 0) return;
  let leafId = options.openTree
    ? await selectTranscriptEntry(ctx, agentDir, states[index])
    : undefined;
  const cache = new Map<string, TranscriptCacheEntry>();
  const read = () => {
    const state = states[index];
    return {
      title: `Subagent ${sanitizeTerminalText(subagentDisplayName(state, states))} · Read-only`,
      markdown:
        readSessionTranscript(agentDir, state, cache, leafId) ||
        sanitizeTerminalText(readLog(state.id)) ||
        "(Waiting for transcript)",
    };
  };
  await showMarkdownPager(ctx, {
    ...read(),
    fullscreen: true,
    read,
    navigate:
      states.length > 1
        ? (direction) => {
            index = (index + direction + states.length) % states.length;
            leafId = undefined;
          }
        : undefined,
  });
}
