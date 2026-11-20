import { type ExtensionAPI, defineTool } from "@earendil-works/pi-coding-agent";
import { buildAlertPayload, deliverAlert } from "@hollowheap/core/alerts";
import { sanitizeTerminalText, toolTextResult } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { appendSessionEntry } from "@hollowheap/core/state";
import { Type } from "typebox";
import { askQuestions } from "./dialogs.js";
import { type Question, formatAnswers } from "./questions.js";
import {
  ANSWERS_TYPE,
  extractAnswerText,
  getQuestionSessionState,
} from "./session.js";

const QuestionItemSchema = Type.Union([
  Type.String({ minLength: 1, description: "Question prompt text" }),
  Type.Object({
    prompt: Type.String({
      minLength: 1,
      description: "Question prompt text",
    }),
    options: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Available choices. If omitted or empty, asks for free-text input.",
      }),
    ),
    multi: Type.Optional(
      Type.Boolean({
        description: "True to allow selecting multiple options.",
      }),
    ),
    page: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Optional page number for multi-page questionnaires.",
      }),
    ),
    condition: Type.Optional(
      Type.String({
        description:
          "Optional condition expression (e.g. \"answer1 == 'Yes'\").",
      }),
    ),
  }),
]);

const QuestionListSchema = Type.Array(QuestionItemSchema);

export function createQuestionTool(pi?: ExtensionAPI) {
  return defineTool({
    name: "question",
    label: "question",
    description:
      "Ask the user one or more questions with single-select, multi-select, or free-text answers. Returns user responses.",
    exposure: "codemode",
    promptGuidelines: [
      "Use tools.question via codemode when you need clarification, user preferences, or decisions between alternatives instead of making blind assumptions.",
      "question is codemode-only: call it as tools.question([...]) or tools.question({ prompt, options }) inside a codemode script, never as a direct top-level tool.",
    ],
    parameters: Type.Union([
      QuestionListSchema,
      Type.Object({
        questions: Type.Optional(QuestionListSchema),
        prompt: Type.Optional(
          Type.String({ description: "Single question prompt shorthand." }),
        ),
        options: Type.Optional(
          Type.Array(Type.String(), {
            description: "Options for single question shorthand.",
          }),
        ),
        multi: Type.Optional(
          Type.Boolean({
            description: "Multi-select flag for single question shorthand.",
          }),
        ),
      }),
    ]),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI || ctx.mode === "print" || ctx.mode === "json") {
        return toolTextResult(
          "Question requires an interactive session (TUI or RPC mode).",
          { cancelled: true, answers: [], reason: "no-ui" },
        );
      }

      const rawQuestions = Array.isArray(params)
        ? params
        : (params.questions ??
          (params.prompt
            ? [
                {
                  prompt: params.prompt,
                  options: params.options,
                  multi: params.multi,
                },
              ]
            : []));

      if (rawQuestions.length === 0) {
        return toolTextResult("Error: No question prompt provided.", {
          cancelled: true,
          answers: [],
        });
      }

      const questions: Question[] = rawQuestions.map((q) => {
        const normalized = typeof q === "string" ? { prompt: q } : q;
        return {
          prompt: sanitizeTerminalText(normalized.prompt),
          mode:
            !normalized.options || normalized.options.length === 0
              ? "free"
              : normalized.multi
                ? "multi"
                : "single",
          options: (normalized.options ?? []).map((option) =>
            sanitizeTerminalText(option),
          ),
          page: normalized.page,
          condition: normalized.condition
            ? sanitizeTerminalText(normalized.condition)
            : normalized.condition,
        };
      });

      void deliverAlert(
        buildAlertPayload("question", undefined, "asked"),
      ).catch(() => {
        // Notification failures do not interrupt the question dialog.
      });

      const answers = await askQuestions(questions, ctx, { signal });
      if (signal?.aborted || answers === undefined || answers.cancelled) {
        return toolTextResult("Question cancelled by user.", {
          cancelled: true,
          answers: answers ?? [],
        });
      }

      const formatted = formatAnswers(answers);
      const now = Date.now();
      appendSessionEntry(pi, ctx?.sessionManager, ANSWERS_TYPE, {
        questions,
        answers,
        askedAt: now,
      });

      const state = getQuestionSessionState(ctx?.sessionManager);
      state.askedCount += 1;
      if (questions.length > 0) {
        state.lastQuestion = questions[questions.length - 1]?.prompt;
      }
      if (answers.length > 0) {
        state.lastAnswer = extractAnswerText(answers[answers.length - 1]);
      }
      state.updatedAt = now;

      if (ctx?.sessionManager) {
        updateSessionSnapshot(ctx.sessionManager, "questions", {
          askedCount: state.askedCount,
          lastQuestion: state.lastQuestion,
          lastAnswer: state.lastAnswer,
          updatedAt: state.updatedAt,
        });
      }

      return toolTextResult(formatted, { cancelled: false, answers });
    },
  });
}
