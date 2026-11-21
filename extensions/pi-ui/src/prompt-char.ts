export const DEFAULT_PROMPT_CHAR = "❯";

let current = DEFAULT_PROMPT_CHAR;

export function setPromptChar(value: string | undefined): void {
  current =
    typeof value === "string" && [...value].length === 1
      ? value
      : DEFAULT_PROMPT_CHAR;
}

export function getPromptChar(): string {
  return current;
}
