export interface TaggedBlock {
  tag: string;
  body: string;
  start: number;
  end: number;
  closed: boolean;
}

export interface HeadingNode {
  type: "heading";
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface ListItemNode {
  type: "listItem";
  text: string;
  checked?: boolean;
}

export interface ListNode {
  type: "list";
  ordered: boolean;
  items: ListItemNode[];
}

export interface ParagraphNode {
  type: "paragraph";
  text: string;
}

export type MarkdownNode = HeadingNode | ListNode | ParagraphNode;

const OPEN_SINGLE = /^'''([a-z][a-z0-9_]*)[ \t]*$/;
const CLOSE_SINGLE = /^'''[ \t]*$/;
const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})([a-z][a-z0-9_]*)[ \t]*$/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/;

interface CodeFence {
  marker: string;
  length: number;
}

interface OpenBlock {
  tag: string;
  start: number;
  lines: string[];
  delimiter: "single" | string;
  markerLength: number;
}

export function scanTaggedBlocks(markdown: string): TaggedBlock[] {
  const blocks: TaggedBlock[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let open: OpenBlock | undefined;
  let codeFence: CodeFence | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const lineStart = offset;
    const lineEnd = lineStart + raw.length;
    const fence = CODE_FENCE.exec(line);

    if (codeFence) {
      if (
        fence &&
        fence[1][0] === codeFence.marker &&
        fence[1].length >= codeFence.length
      ) {
        codeFence = undefined;
      }
      if (open) open.lines.push(line);
    } else if (open) {
      const isClose =
        open.delimiter === "single"
          ? CLOSE_SINGLE.test(line)
          : fence !== null &&
            fence[1][0] === open.delimiter &&
            fence[1].length >= open.markerLength &&
            line.slice(fence[0].length).trim() === "";

      if (isClose) {
        blocks.push({
          tag: open.tag,
          body: open.lines.join("\n"),
          start: open.start,
          end: lineEnd,
          closed: true,
        });
        open = undefined;
      } else if (fence) {
        codeFence = { marker: fence[1][0], length: fence[1].length };
        open.lines.push(line);
      } else {
        open.lines.push(line);
      }
    } else {
      const matchSingle = OPEN_SINGLE.exec(line);
      const matchFence = OPEN_FENCE.exec(line);

      if (matchSingle) {
        open = {
          tag: matchSingle[1],
          start: lineStart,
          lines: [],
          delimiter: "single",
          markerLength: 3,
        };
      } else if (matchFence) {
        open = {
          tag: matchFence[2],
          start: lineStart,
          lines: [],
          delimiter: matchFence[1][0],
          markerLength: matchFence[1].length,
        };
      } else if (fence) {
        codeFence = { marker: fence[1][0], length: fence[1].length };
      }
    }

    offset = lineEnd + (index < lines.length - 1 ? 1 : 0);
  }

  if (open) {
    blocks.push({
      tag: open.tag,
      body: open.lines.join("\n"),
      start: open.start,
      end: markdown.length,
      closed: false,
    });
  }

  return blocks;
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const ORDERED_ITEM = /^ {0,3}\d+[.)]\s+(.*)$/;
const UNORDERED_ITEM = /^ {0,3}[-*+]\s+(.*)$/;
const CHECKBOX_ITEM = /^\[([ xX])\](?:\s+(.*))?$/;

function parseListItem(text: string): ListItemNode {
  const trimmed = text.trim();
  const checkbox = CHECKBOX_ITEM.exec(trimmed);
  if (!checkbox) return { type: "listItem", text: trimmed };
  return {
    type: "listItem",
    text: (checkbox[2] ?? "").trim(),
    checked: checkbox[1].toLowerCase() === "x",
  };
}

export function parseMarkdownBlocks(body: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const paragraphLines: string[] = [];
  let list: ListNode | undefined;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    nodes.push({ type: "paragraph", text: paragraphLines.join(" ") });
    paragraphLines.length = 0;
  };

  const flushList = () => {
    list = undefined;
  };

  for (const raw of body.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      nodes.push({
        type: "heading",
        depth: heading[1].length as HeadingNode["depth"],
        text: heading[2].trim(),
      });
      continue;
    }

    const ordered = ORDERED_ITEM.exec(line);
    const unordered = ordered ? undefined : UNORDERED_ITEM.exec(line);
    const item = ordered ?? unordered;
    if (item) {
      flushParagraph();
      const orderedList = ordered !== null;
      const listItem = parseListItem(item[1]);
      if (list && list.ordered === orderedList) {
        list.items.push(listItem);
      } else {
        list = { type: "list", ordered: orderedList, items: [listItem] };
        nodes.push(list);
      }
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  return nodes;
}
