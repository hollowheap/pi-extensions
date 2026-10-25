import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function fitLines(
  lines: string[],
  width: number,
  align: "left" | "center" = "left",
): string[] {
  return lines.map((line) => {
    const truncated = truncateToWidth(line, width);
    const gap = width - visibleWidth(truncated);
    if (gap <= 0) return truncated;
    if (align === "center") {
      const left = Math.floor(gap / 2);
      return " ".repeat(left) + truncated + " ".repeat(gap - left);
    }
    return truncated + " ".repeat(gap);
  });
}

export function splitOutput(stdout: string): string[] {
  const lines = stdout.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
