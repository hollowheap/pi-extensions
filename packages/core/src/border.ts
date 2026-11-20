export type BorderStyle =
  | "rounded"
  | "sharp"
  | "square"
  | "double"
  | "dashed"
  | "dotted"
  | "none";

export const BORDER_STYLES: readonly BorderStyle[] = [
  "rounded",
  "sharp",
  "square",
  "double",
  "dashed",
  "dotted",
  "none",
];

export interface BorderChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
}

export function getBorderChars(style: string): BorderChars {
  switch (style) {
    case "double":
      return {
        topLeft: "╔",
        topRight: "╗",
        bottomLeft: "╚",
        bottomRight: "╝",
        horizontal: "═",
        vertical: "║",
      };
    case "dashed":
      return {
        topLeft: "┌",
        topRight: "┐",
        bottomLeft: "└",
        bottomRight: "┘",
        horizontal: "┄",
        vertical: "┆",
      };
    case "dotted":
      return {
        topLeft: "┌",
        topRight: "┐",
        bottomLeft: "└",
        bottomRight: "┘",
        horizontal: "┈",
        vertical: "┊",
      };
    case "sharp":
    case "square":
      return {
        topLeft: "┌",
        topRight: "┐",
        bottomLeft: "└",
        bottomRight: "┘",
        horizontal: "─",
        vertical: "│",
      };
    case "none":
      return {
        topLeft: "",
        topRight: "",
        bottomLeft: "",
        bottomRight: "",
        horizontal: "",
        vertical: "",
      };
    default:
      return {
        topLeft: "╭",
        topRight: "╮",
        bottomLeft: "╰",
        bottomRight: "╯",
        horizontal: "─",
        vertical: "│",
      };
  }
}
