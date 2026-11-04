import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Draw a rounded box around already-rendered lines. */
export function roundedFrame(
  lines: readonly string[],
  width: number,
  theme: Theme,
  title?: string,
): string[] {
  const safeWidth = Math.max(4, width);
  const innerWidth = safeWidth - 4;
  const border = (value: string) => theme.fg("border", value);

  const rawLabel = title ? ` ${theme.fg("accent", theme.bold(title))} ` : "";
  const label = truncateToWidth(rawLabel, Math.max(0, safeWidth - 3), "");
  const labelWidth = visibleWidth(label);
  const topFill = Math.max(0, safeWidth - 3 - labelWidth);
  const top = border("╭─") + label + border(`${"─".repeat(topFill)}╮`);
  const bottom = border(`╰${"─".repeat(safeWidth - 2)}╯`);

  const body = lines.map((line) => {
    const text = truncateToWidth(line, innerWidth, "");
    const padding = Math.max(0, innerWidth - visibleWidth(text));
    return `${border("│")} ${text}${" ".repeat(padding)} ${border("│")}`;
  });

  return [top, ...body, bottom];
}
