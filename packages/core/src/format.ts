import { relative, sep } from "node:path";

const TRUNCATE_THRESHOLD = 4000;
const HEAD_LENGTH = 3000;
const TAIL_LENGTH = 1000;
const TARGET_LENGTH = 500;

export function truncateText(text: string, label = "truncated"): string {
  if (text.length <= TRUNCATE_THRESHOLD) return text;
  const cut = text.length - TRUNCATE_THRESHOLD;
  return `${text.slice(0, HEAD_LENGTH)}\n[${label}: cut ${cut} characters]\n${text.slice(-TAIL_LENGTH)}`;
}

export function displayTarget(target: string): string {
  return target.length > TARGET_LENGTH
    ? `${target.slice(0, TARGET_LENGTH)}…`
    : target;
}

export function displayPath(base: string, absolute: string): string {
  const rel = relative(base, absolute).split(sep).join("/");
  return rel.endsWith("/") && rel.length > 1 ? rel.slice(0, -1) : rel;
}

function skipCsi(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0x30 && code <= 0x3f) {
      index += 1;
    } else {
      break;
    }
  }
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0x20 && code <= 0x2f) {
      index += 1;
    } else {
      break;
    }
  }
  if (index < text.length) {
    const finalCode = text.charCodeAt(index);
    if (finalCode >= 0x40 && finalCode <= 0x7e) {
      index += 1;
    }
  }
  return index;
}

function skipControlString(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x07 || code === 0x9c) {
      return index + 1;
    }
    if (code === 0x1b && text.charCodeAt(index + 1) === 0x5c) {
      return index + 2;
    }
    if (code === 0x0a) {
      return index;
    }
    index += 1;
  }
  return index;
}

export interface SanitizeTerminalOptions {
  allowSgr?: boolean;
}

export function sanitizeTerminalText(
  text: string,
  options?: SanitizeTerminalOptions,
): string {
  const allowSgr = options?.allowSgr === true;
  let out = "";
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x1b) {
      const next = text.charCodeAt(index + 1);
      if (next === 0x5b) {
        if (allowSgr) {
          let sgrIdx = index + 2;
          while (sgrIdx < text.length) {
            const p = text.charCodeAt(sgrIdx);
            if ((p >= 0x30 && p <= 0x39) || p === 0x3b || p === 0x3a) {
              sgrIdx += 1;
            } else {
              break;
            }
          }
          if (sgrIdx < text.length && text.charCodeAt(sgrIdx) === 0x6d) {
            out += text.slice(index, sgrIdx + 1);
            index = sgrIdx + 1;
            continue;
          }
        }
        index = skipCsi(text, index + 2);
        continue;
      }
      if (
        next === 0x5d ||
        next === 0x50 ||
        next === 0x58 ||
        next === 0x5e ||
        next === 0x5f
      ) {
        index = skipControlString(text, index + 2);
        continue;
      }
      index += 1;
      while (index < text.length) {
        const inter = text.charCodeAt(index);
        if (inter >= 0x20 && inter <= 0x2f) {
          index += 1;
        } else {
          break;
        }
      }
      if (index < text.length) {
        const finalCode = text.charCodeAt(index);
        if (finalCode >= 0x30 && finalCode <= 0x7e) {
          index += 1;
        }
      }
      continue;
    }
    if (code === 0x9b) {
      index = skipCsi(text, index + 1);
      continue;
    }
    if (
      (code <= 0x1f && code !== 0x09 && code !== 0x0a) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      index += 1;
      continue;
    }
    out += text[index];
    index += 1;
  }
  return out;
}
