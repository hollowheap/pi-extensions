import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function fitLines(lines: string[], width: number): string[] {
  return lines.map((line) => {
    const truncated = truncateToWidth(line, width);
    const pad = width - visibleWidth(truncated);
    return pad > 0 ? truncated + " ".repeat(pad) : truncated;
  });
}

export function splitOutput(stdout: string): string[] {
  const lines = stdout.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
