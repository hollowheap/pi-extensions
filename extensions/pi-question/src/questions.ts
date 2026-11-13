export const MAX_ANSWER = 500;
export const WRITE_IN_LABEL = "Write-in answer";
export const DONE_LABEL = "Done";

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
  answers: readonly (QuestionAnswer | undefined)[],
): boolean {
  if (!condition) return true;
  // Simple: "answer1 == 'value'" or "answer1 != 'value'"
  const match = condition.match(/^answer(\d+)\s*==\s*['"](.+)['"]$/);
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
  const notMatch = condition.match(/^answer(\d+)\s*!=\s*['"](.+)['"]$/);
  if (notMatch) {
    const idx = Number(notMatch[1]) - 1;
    const answer = answers[idx];
    if (!answer) return false;
    const value =
      answer.mode === "single"
        ? answer.value
        : answer.mode === "multi"
          ? answer.selected.join(",")
          : answer.value;
    return value !== notMatch[2];
  }
  return false;
}

export function formatAnswers(
  answers: readonly ((QuestionAnswer & { prompt?: string }) | undefined)[],
  questions?: readonly Question[],
): string {
  if (answers.length === 0) return "";
  const count = questions !== undefined ? questions.length : answers.length;
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const answer = answers[index];
    const prompt = questions?.[index]?.prompt ?? answer?.prompt;
    const ansText = answer !== undefined ? formatAnswer(answer) : "skipped";
    if (prompt !== undefined) {
      lines.push(`${index + 1}. ${prompt}: ${ansText}`);
    } else {
      lines.push(`${index + 1}. ${ansText}`);
    }
  }
  return lines.join("\n");
}
