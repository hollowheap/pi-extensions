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
        horizontal: "┈",
        vertical: "┊",
      };
    case "sharp":
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
