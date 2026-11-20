import { decodeKittyPrintable } from "@earendil-works/pi-tui";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const MODIFY_OTHER_KEYS_PREFIX = "\x1b[27;";
const MODIFY_OTHER_KEYS_ARGS = /^\d+;\d+$/;
const MODIFIER_SHIFT = 1;
const LOCK_MASK = 64 + 128;

function decodeModifyOtherKeysPrintable(data: string): string | undefined {
  if (!data.startsWith(MODIFY_OTHER_KEYS_PREFIX) || !data.endsWith("~")) {
    return undefined;
  }
  const args = data.slice(MODIFY_OTHER_KEYS_PREFIX.length, -1);
  if (!MODIFY_OTHER_KEYS_ARGS.test(args)) return undefined;
  const [modifierArg, codepointArg] = args.split(";");
  const modifier = Number.parseInt(modifierArg ?? "", 10) - 1;
  if (
    !Number.isFinite(modifier) ||
    (modifier & ~LOCK_MASK & ~MODIFIER_SHIFT) !== 0
  ) {
    return undefined;
  }
  const codepoint = Number.parseInt(codepointArg ?? "", 10);
  if (!Number.isFinite(codepoint) || codepoint < 32) return undefined;
  try {
    return String.fromCodePoint(codepoint);
  } catch {
    return undefined;
  }
}

export function decodePrintableInput(data: string): string | undefined {
  let payload: string;
  if (data.startsWith(PASTE_START)) {
    const end = data.indexOf(PASTE_END, PASTE_START.length);
    if (end === -1) return undefined;
    payload = data.slice(PASTE_START.length, end);
  } else {
    const kitty = decodeKittyPrintable(data);
    if (kitty !== undefined) {
      payload = kitty;
    } else {
      const other = decodeModifyOtherKeysPrintable(data);
      if (other !== undefined) {
        payload = other;
      } else if (data.length === 1) {
        payload = data;
      } else {
        return undefined;
      }
    }
  }
  const printable = [...payload]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("");
  return printable === "" ? undefined : printable;
}
