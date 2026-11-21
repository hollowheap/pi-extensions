import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ANSWERS_TYPE } from "@hollowheap/core/custom-types";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { readBranchEntries } from "@hollowheap/core/state";
import { type QuestionAnswer, capAnswer } from "./questions.js";

export { ANSWERS_TYPE };

export interface QuestionSessionState {
  askedCount: number;
  lastQuestion?: string;
  lastAnswer?: string;
  updatedAt: number;
}

const sessionStates = new WeakMap<object, QuestionSessionState>();
const fallbackQuestionState: QuestionSessionState = {
  askedCount: 0,
  updatedAt: 0,
};

export function extractAnswerText(answer: unknown): string | undefined {
  if (typeof answer === "string") return answer;
  if (!answer || typeof answer !== "object") return undefined;
  const a = answer as QuestionAnswer;
  if (a.mode === "single" || a.mode === "free") return a.value;
  if (a.mode === "multi") {
    const parts = (a.selected ?? []).map(capAnswer);
    if (a.writeIn) parts.push(`Write-in: ${capAnswer(a.writeIn)}`);
    return parts.length === 0 ? "none selected" : parts.join(", ");
  }
  if ("value" in a && typeof (a as { value: unknown }).value === "string") {
    return (a as { value: string }).value;
  }
  return undefined;
}

export function getQuestionSessionState(
  sessionManager?: unknown,
): QuestionSessionState {
  if (typeof sessionManager === "object" && sessionManager !== null) {
    let state = sessionStates.get(sessionManager);
    if (state === undefined) {
      state = { askedCount: 0, updatedAt: 0 };
      sessionStates.set(sessionManager, state);
    }
    return state;
  }
  return fallbackQuestionState;
}

export function restoreFromEntries(
  entries: readonly unknown[],
): QuestionSessionState {
  let askedCount = 0;
  let lastQuestion: string | undefined;
  let lastAnswer: string | undefined;
  let updatedAt = 0;

  for (const entry of entries) {
    const raw = entry as {
      type?: string;
      customType?: string;
      data?: unknown;
    };
    if (
      (raw.type === "custom" && raw.customType === ANSWERS_TYPE) ||
      raw.type === ANSWERS_TYPE
    ) {
      askedCount += 1;
      const data = raw.data as
        | {
            questions?: Array<{ prompt?: string } | string>;
            answers?: Array<unknown>;
            askedAt?: number;
          }
        | undefined;
      if (Array.isArray(data?.questions) && data.questions.length > 0) {
        const lastQ = data.questions[data.questions.length - 1];
        lastQuestion = typeof lastQ === "string" ? lastQ : lastQ?.prompt;
      }
      if (Array.isArray(data?.answers) && data.answers.length > 0) {
        const lastA = data.answers[data.answers.length - 1];
        lastAnswer = extractAnswerText(lastA);
      }
      if (typeof data?.askedAt === "number") {
        updatedAt = data.askedAt;
      }
    }
  }

  return { askedCount, lastQuestion, lastAnswer, updatedAt };
}

export function restoreQuestionSession(ctx?: ExtensionContext): void {
  if (!ctx) return;
  const entries = readBranchEntries(ctx.sessionManager) ?? [];
  const restored = restoreFromEntries(entries);
  const state = getQuestionSessionState(ctx.sessionManager);
  state.askedCount = restored.askedCount;
  state.lastQuestion = restored.lastQuestion;
  state.lastAnswer = restored.lastAnswer;
  state.updatedAt = restored.updatedAt;

  if (ctx.sessionManager) {
    updateSessionSnapshot(ctx.sessionManager, "questions", {
      askedCount: state.askedCount,
      lastQuestion: state.lastQuestion,
      lastAnswer: state.lastAnswer,
      updatedAt: state.updatedAt,
    });
  }
}
