import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export function safeFg(
  theme: Theme | undefined,
  token: ThemeColor,
  value: string,
  colored = true,
): string {
  return colored && typeof theme?.fg === "function"
    ? theme.fg(token, value)
    : value;
}

export function safeBold(theme: Theme | undefined, value: string): string {
  return typeof theme?.bold === "function" ? theme.bold(value) : value;
}
