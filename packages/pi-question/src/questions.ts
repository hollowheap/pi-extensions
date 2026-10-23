import { type ListItemNode, parseMarkdownBlocks } from "@hollowheap/core";

export const MAX_ANSWER = 500;
export const WRITE_IN_LABEL = "Write-in answer";

export type QuestionMode = "single" | "multi" | "free";

export interface Question {
  prompt: string;
  mode: QuestionMode;
  options: string[];
}

export type QuestionAnswer =
  | { mode: "single"; value: string }
  | { mode: "multi"; selected: string[]; writeIn?: string }
  | { mode: "free"; value: string };

export function capAnswer(text: string): string {
  return text.slice(0, MAX_ANSWER);
}

function toQuestion(
  prompt: string,
  items: readonly ListItemNode[],
): Question | undefined {
  if (prompt.length === 0 || items.length > 8) return undefined;

  const options = items.map((item) => item.text.trim());
  if (
    options.some((option) => option.length === 0 || option === WRITE_IN_LABEL)
  ) {
    return undefined;
  }

  const marked = items.filter((item) => item.checked !== undefined).length;
  if (marked !== 0 && marked !== items.length) return undefined;

  if (items.length === 0) {
    return { prompt, mode: "free", options: [] };
  }

  return {
    prompt,
    mode: marked === 0 ? "single" : "multi",
    options,
  };
}

export function parseQuestionBlock(body: string): Question[] | undefined {
  const questions: Question[] = [];
  let current: { prompt: string; items: ListItemNode[] } | undefined;
  let sawH2 = false;
  let invalid = false;

  const finish = () => {
    if (!current) return;
    const question = toQuestion(current.prompt, current.items);
    if (question) {
      questions.push(question);
    } else {
      invalid = true;
    }
    current = undefined;
  };

  for (const node of parseMarkdownBlocks(body)) {
    if (node.type === "heading") {
      if (node.depth !== 2) continue;
      sawH2 = true;
      finish();
      current = { prompt: node.text.trim(), items: [] };
      continue;
    }

    if (node.type !== "list") continue;

    if (!node.ordered || !current) {
      invalid = true;
      continue;
    }
    current.items.push(...node.items);
  }

  finish();
  return sawH2 && !invalid ? questions : undefined;
}

function formatAnswer(answer: QuestionAnswer): string {
  if (answer.mode === "multi") {
    const parts = answer.selected.map(capAnswer);
    const writeIn =
      answer.writeIn === undefined || answer.writeIn.length === 0
        ? undefined
        : capAnswer(answer.writeIn);
    if (writeIn !== undefined) parts.push(`Write-in: ${writeIn}`);
    return parts.length === 0 ? "none selected" : parts.join(", ");
  }

  if (answer.value.length === 0) return "no answer";
  return capAnswer(answer.value);
}

export function formatAnswers(answers: readonly QuestionAnswer[]): string {
  return answers
    .map((answer, index) => `${index + 1}. ${formatAnswer(answer)}`)
    .join("\n");
}
