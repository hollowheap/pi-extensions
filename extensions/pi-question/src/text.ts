import type {
  ExtensionContext,
  ExtensionUIDialogOptions,
} from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable } from "@earendil-works/pi-tui";
import { canOverlay } from "@hollowheap/pi-ui/host";

export interface QuestionDialogOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function printableKey(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  if (data.length !== 1) return undefined;
  const code = data.charCodeAt(0);
  return code >= 32 && code !== 127 ? data : undefined;
}

export function insertAtCaret(
  text: string,
  caret: number,
  value: string,
): { text: string; caret: number } {
  const chars = Array.from(text);
  const inserted = Array.from(value);
  return {
    text: chars.slice(0, caret).concat(inserted, chars.slice(caret)).join(""),
    caret: caret + inserted.length,
  };
}

export function deleteBeforeCaret(
  text: string,
  caret: number,
): { text: string; caret: number } {
  if (caret <= 0) return { text, caret };
  const chars = Array.from(text);
  chars.splice(caret - 1, 1);
  return { text: chars.join(""), caret: caret - 1 };
}

export function dialogOptions(
  ctx: ExtensionContext,
  lockOptions: QuestionDialogOptions,
): ExtensionUIDialogOptions & { overlay?: boolean } {
  return {
    signal: lockOptions.signal,
    timeout: lockOptions.timeoutMs,
    ...(canOverlay(ctx) ? { overlay: false } : {}),
  };
}
