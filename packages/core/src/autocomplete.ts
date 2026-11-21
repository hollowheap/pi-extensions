export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

/** Match a command argument while retaining the order of its candidates. */
export function prefixCompletions(
  prefix: string,
  candidates: Iterable<string>,
): CompletionItem[];
export function prefixCompletions<T>(
  prefix: string,
  candidates: Iterable<T>,
  toItem: (item: T) => CompletionItem,
): CompletionItem[];
export function prefixCompletions<T>(
  prefix: string,
  candidates: Iterable<T>,
  toItem?: (item: T) => CompletionItem,
): CompletionItem[] {
  const query = prefix.toLowerCase();
  const matches: CompletionItem[] = [];
  for (const candidate of candidates) {
    const item = toItem
      ? toItem(candidate)
      : { value: candidate as string, label: candidate as string };
    if (item.value.toLowerCase().startsWith(query)) {
      matches.push(item);
    }
  }
  return matches;
}

/** Replace the token before the cursor and leave the rest of the input intact. */
export function applyTokenCompletion(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
  value: string,
  prefix: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
  const currentLine = lines[cursorLine] ?? "";
  const start = Math.max(0, cursorCol - prefix.length);
  const suffix = currentLine.slice(cursorCol);
  const inserted = /^\s/.test(suffix) ? value : `${value} `;
  const updatedLines = [...lines];
  updatedLines[cursorLine] = currentLine.slice(0, start) + inserted + suffix;
  return {
    lines: updatedLines,
    cursorLine,
    cursorCol: start + inserted.length,
  };
}
