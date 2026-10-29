import { type ListItemNode, parseMarkdownBlocks } from "@hollowheap/core";

export const MAX_ANSWER = 500;
export const WRITE_IN_LABEL = "Write-in answer";

export type QuestionMode = "single" | "multi" | "free";

export interface Question {
  prompt: string;
  mode: QuestionMode;
  options: string[];
  page?: number;
  condition?: string;
}

export type QuestionAnswer =
  | { mode: "single"; value: string }
  | { mode: "multi"; selected: string[]; writeIn?: string }
  | { mode: "free"; value: string };

export function capAnswer(text: string): string {
  return text.slice(0, MAX_ANSWER);
}

function parseQuestionMeta(prompt: string): {
  cleanPrompt: string;
  page?: number;
  condition?: string;
} {
  let cleanPrompt = prompt;
  let page: number | undefined;
  let condition: string | undefined;

  const pageMatch = cleanPrompt.match(/\[page:\s*(\d+)\]/);
  if (pageMatch) {
    page = Number(pageMatch[1]);
    cleanPrompt = cleanPrompt.replace(pageMatch[0], "").trim();
  }

  const condMatch = cleanPrompt.match(/\[if:\s*(.+?)\]/);
  if (condMatch) {
    condition = condMatch[1].trim();
    cleanPrompt = cleanPrompt.replace(condMatch[0], "").trim();
  }

  return { cleanPrompt, page, condition };
}

function toQuestion(
  prompt: string,
  items: readonly ListItemNode[],
): Question | undefined {
  const { cleanPrompt, page, condition } = parseQuestionMeta(prompt);
  if (cleanPrompt.length === 0 || items.length > 8) return undefined;

  const options = items.map((item) => item.text.trim());
  if (
    options.some((option) => option.length === 0 || option === WRITE_IN_LABEL)
  ) {
    return undefined;
  }

  const marked = items.filter((item) => item.checked !== undefined).length;
  if (marked !== 0 && marked !== items.length) return undefined;

  if (items.length === 0) {
    return { prompt: cleanPrompt, mode: "free", options: [], page, condition };
  }

  return {
    prompt: cleanPrompt,
    mode: marked === 0 ? "single" : "multi",
    options,
    page,
    condition,
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

export function evaluateCondition(
  condition: string | undefined,
  answers: readonly QuestionAnswer[],
): boolean {
  if (!condition) return true;
  // Simple: "answer1 == 'value'" or "answer1 != 'value'"
  const match = condition.match(/^answer(\\d+)\\s*==\\s*['\"](.+)['\"]$/);
  if (match) {
    const idx = Number(match[1]) - 1;
    const answer = answers[idx];
    if (!answer) return false;
    const value =
      answer.mode === "single"
        ? answer.value
        : answer.mode === "multi"
          ? answer.selected.join(",")
          : answer.value;
    return value === match[2];
  }
  const notMatch = condition.match(/^answer(\\d+)\\s*!=\\s*['\"](.+)['\"]$/);
  if (notMatch) {
    const idx = Number(notMatch[1]) - 1;
    const answer = answers[idx];
    if (!answer) return true;
    const value =
      answer.mode === "single"
        ? answer.value
        : answer.mode === "multi"
          ? answer.selected.join(",")
          : answer.value;
    return value !== notMatch[2];
  }
  return true;
}

export function formatAnswers(answers: readonly QuestionAnswer[]): string {
  return answers
    .map((answer, index) => `${index + 1}. ${formatAnswer(answer)}`)
    .join("\n");
}
