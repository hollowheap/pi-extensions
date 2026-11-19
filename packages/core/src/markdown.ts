const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const DIVIDER_RE = /^[ \t]*(?:={3,}|-{3,})[ \t]*$/;

/** Normalize agent divider lines outside fenced blocks into Markdown rules. */
export function normalizeAgentMarkdown(markdown: string): string {
  if (!markdown.includes("---") && !markdown.includes("===")) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const out: string[] = [];
  let activeFenceChar: "`" | "~" | null = null;
  let activeFenceLen = 0;

  for (const line of lines) {
    const cleanLine = line.endsWith("\r") ? line.slice(0, -1) : line;
    const fenceMatch = FENCE_RE.exec(cleanLine);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      const markerChar = marker[0] as "`" | "~";
      if (activeFenceChar === null) {
        activeFenceChar = markerChar;
        activeFenceLen = marker.length;
        out.push(line);
        continue;
      }
      if (
        markerChar === activeFenceChar &&
        marker.length >= activeFenceLen &&
        cleanLine.trim() === marker
      ) {
        activeFenceChar = null;
        activeFenceLen = 0;
        out.push(line);
        continue;
      }
    }

    if (activeFenceChar !== null) {
      out.push(line);
      continue;
    }

    if (DIVIDER_RE.test(cleanLine)) {
      const prev = out.at(-1);
      if (prev !== undefined && prev.trim() !== "") {
        out.push("");
      }
      out.push(line.endsWith("\r") ? "---\r" : "---");
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}
