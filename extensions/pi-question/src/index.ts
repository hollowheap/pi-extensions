import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIDialogOptions,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  Text,
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { roundedFrame } from "@hollowheap/tui/frame";
import { Type } from "typebox";
import { alertQuestion } from "./alerts.js";
import {
  DONE_LABEL,
  type Question,
  type QuestionAnswer,
  WRITE_IN_LABEL,
  capAnswer,
  evaluateCondition,
  formatAnswers,
} from "./questions.js";

export const ANSWERS_TYPE = "hollowheap.question.answers";

interface MultiResult {
  selected: string[];
  writeIn?: string;
  cancelled: boolean;
}

function printableKey(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  if (data.length !== 1) return undefined;
  const code = data.charCodeAt(0);
  return code >= 32 && code !== 127 ? data : undefined;
}

export interface QuestionDialogOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function isAbortOrTimeout(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (
      error.message.includes("aborted") ||
      error.message.includes("timeout")
    ) {
      return true;
    }
  }
  return false;
}

function dialogOptions(lockOptions: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): ExtensionUIDialogOptions {
  return { signal: lockOptions.signal, timeout: lockOptions.timeoutMs };
}

function watchAbort(
  signal: AbortSignal | undefined,
  onAbort: () => void,
): () => void {
  if (signal === undefined) return () => {};
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

async function askMulti(
  question: Question,
  ctx: ExtensionContext,
  options?: QuestionDialogOptions,
): Promise<MultiResult | undefined> {
  const lockOptions = {
    signal: options?.signal ?? (ctx as { signal?: AbortSignal }).signal,
    timeoutMs: options?.timeoutMs,
  };
  if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
    try {
      return await withPromptLock(
        () =>
          ctx.ui.custom<MultiResult>(
            (tui, theme, _keybindings, done) => {
              const writeInRow = question.options.length;
              const doneRow = writeInRow + 1;
              const selected = new Set<number>();
              let cursor = 0;
              let editing = false;
              let writeIn = "";
              let draft = "";
              let finished = false;

              const refresh = () => tui.requestRender();

              let stopWatching: () => void = () => {};
              const finish = (result: MultiResult) => {
                if (finished) return;
                finished = true;
                stopWatching();
                done(result);
              };

              stopWatching = watchAbort(lockOptions.signal, () =>
                finish({ selected: [], writeIn: undefined, cancelled: true }),
              );

              const submit = () => {
                finish({
                  selected: question.options.filter((_, index) =>
                    selected.has(index),
                  ),
                  writeIn: writeIn.length === 0 ? undefined : writeIn,
                  cancelled: false,
                });
              };

              const startEditing = () => {
                editing = true;
                cursor = writeInRow;
                draft = writeIn;
                refresh();
              };

              const toggle = (index: number) => {
                if (selected.has(index)) selected.delete(index);
                else selected.add(index);
                refresh();
              };

              const handleInput = (data: string) => {
                if (editing) {
                  if (matchesKey(data, Key.escape)) {
                    editing = false;
                    refresh();
                    return;
                  }
                  if (matchesKey(data, Key.enter)) {
                    writeIn = capAnswer(draft);
                    editing = false;
                    cursor = doneRow;
                    refresh();
                    return;
                  }
                  if (matchesKey(data, Key.backspace)) {
                    draft = Array.from(draft).slice(0, -1).join("");
                    refresh();
                    return;
                  }
                  const printable = printableKey(data);
                  if (printable !== undefined) {
                    draft = capAnswer(draft + printable);
                    refresh();
                  }
                  return;
                }

                if (matchesKey(data, Key.escape)) {
                  finish({ selected: [], writeIn: undefined, cancelled: true });
                  return;
                }
                if (matchesKey(data, Key.up)) {
                  cursor = Math.max(0, cursor - 1);
                  refresh();
                  return;
                }
                if (matchesKey(data, Key.down)) {
                  cursor = Math.min(doneRow, cursor + 1);
                  refresh();
                  return;
                }
                if (matchesKey(data, Key.space)) {
                  if (cursor < writeInRow) toggle(cursor);
                  else if (cursor === writeInRow) startEditing();
                  return;
                }
                if (matchesKey(data, Key.enter)) {
                  if (cursor === doneRow) submit();
                  else if (cursor === writeInRow) startEditing();
                  else toggle(cursor);
                }
              };

              const render = (width: number): string[] => {
                const innerWidth = Math.max(1, width - 4);
                const lines: string[] = [];
                question.options.forEach((option, index) => {
                  const pointer = cursor === index ? ">" : " ";
                  const mark = selected.has(index) ? "x" : " ";
                  lines.push(`${pointer} [${mark}] ${option}`);
                });
                const pointer = cursor === writeInRow ? ">" : " ";
                const suffix = writeIn.length === 0 ? "" : `: ${writeIn}`;
                lines.push(`${pointer} [ ] ${WRITE_IN_LABEL}${suffix}`);
                if (editing) lines.push(`❯ ${draft}█`);
                lines.push(`${cursor === doneRow ? ">" : " "} Done`);
                lines.push("Space toggles • Enter selects • Esc cancels");
                const body = new Text(lines.join("\n"), 0, 0).render(
                  innerWidth,
                );
                return roundedFrame(body, width, theme, question.prompt);
              };

              return {
                render,
                invalidate: () => {},
                handleInput,
                dispose: () => {
                  finish({ selected: [], writeIn: undefined, cancelled: true });
                },
              };
            },
            {
              overlay: true,
              overlayOptions: {
                width: "70%",
                maxHeight: "75%",
                margin: 1,
              },
            },
          ),
        lockOptions,
      );
    } catch (error) {
      if (isAbortOrTimeout(error, lockOptions.signal)) return undefined;
      throw error;
    }
  }

  if (typeof ctx.ui?.select !== "function") return undefined;

  const selected = new Set<number>();
  let writeIn: string | undefined;

  for (;;) {
    const rows = [
      ...question.options.map(
        (option, index) => `${selected.has(index) ? "[x]" : "[ ]"} ${option}`,
      ),
      WRITE_IN_LABEL,
      DONE_LABEL,
    ];
    let picked: string | undefined;
    try {
      picked = await withPromptLock(
        () => ctx.ui.select(question.prompt, rows, dialogOptions(lockOptions)),
        lockOptions,
      );
    } catch (error) {
      if (isAbortOrTimeout(error, lockOptions.signal)) return undefined;
      throw error;
    }
    if (picked === undefined) return undefined;

    if (picked === DONE_LABEL) {
      return {
        selected: question.options.filter((_, index) => selected.has(index)),
        writeIn,
        cancelled: false,
      };
    }

    if (picked === WRITE_IN_LABEL) {
      const answer = await askWriteIn(
        ctx,
        question.prompt,
        "Custom answer",
        options,
      );
      if (answer === undefined) return undefined;
      writeIn = capAnswer(answer);
      continue;
    }

    const index = rows.indexOf(picked);
    if (index < 0 || index >= question.options.length) return undefined;
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
  }
}

async function askWriteIn(
  ctx: ExtensionContext,
  title: string,
  placeholder?: string,
  options?: QuestionDialogOptions,
): Promise<string | undefined> {
  const lockOptions = {
    signal: options?.signal ?? (ctx as { signal?: AbortSignal }).signal,
    timeoutMs: options?.timeoutMs,
  };
  if (ctx.mode === "tui" && typeof ctx.ui?.custom === "function") {
    try {
      return await withPromptLock(
        () =>
          ctx.ui.custom<string | undefined>(
            (tui, theme, _keybindings, done) => {
              let draft = "";
              let settled = false;
              let stopWatching: () => void = () => {};

              const finish = (value: string | undefined): void => {
                if (settled) return;
                settled = true;
                stopWatching();
                done(value);
              };

              stopWatching = watchAbort(lockOptions.signal, () =>
                finish(undefined),
              );

              const border = (val: string) =>
                typeof theme?.fg === "function" ? theme.fg("border", val) : val;
              const fg = (token: string, val: string) =>
                typeof theme?.fg === "function"
                  ? theme.fg(token as never, val)
                  : val;
              const bold = (val: string) =>
                typeof theme?.bold === "function" ? theme.bold(val) : val;

              return {
                render(width: number): string[] {
                  const safeWidth = Math.max(4, width);
                  const innerWidth = safeWidth - 4;

                  const rawTitle = ` ${fg("accent", bold(title))} `;
                  const titleLabel = truncateToWidth(
                    rawTitle,
                    Math.max(0, safeWidth - 3),
                    "",
                  );
                  const topFill = Math.max(
                    0,
                    safeWidth - 3 - visibleWidth(titleLabel),
                  );
                  const top =
                    border("╭─") +
                    titleLabel +
                    border(`${"─".repeat(topFill)}╮`);

                  const hintText = " Enter submits • Esc cancels ";
                  const hintLabel = truncateToWidth(
                    fg("muted", hintText),
                    Math.max(0, safeWidth - 3),
                    "",
                  );
                  const hintFill = Math.max(
                    0,
                    safeWidth - 3 - visibleWidth(hintLabel),
                  );
                  const bottom =
                    border("╰─") +
                    hintLabel +
                    border(`${"─".repeat(hintFill)}╯`);

                  const fullText =
                    draft.length === 0 && placeholder
                      ? `${fg("muted", placeholder)}█`
                      : `${draft}█`;
                  const wrappedLines = new Text(fullText, 0, 0).render(
                    innerWidth,
                  );
                  const rawLines =
                    wrappedLines.length === 0 ? ["█"] : wrappedLines;
                  const contentLines = rawLines.map((line, idx) => {
                    const isFirst = idx === 0;
                    const text = truncateToWidth(
                      line.trimEnd(),
                      innerWidth,
                      "",
                    );
                    const padding = Math.max(
                      0,
                      innerWidth - visibleWidth(text),
                    );
                    const left = isFirst
                      ? `${fg("accent", "❯")} `
                      : `${border("│")} `;
                    const right = ` ${border("│")}`;
                    return `${left}${text}${" ".repeat(padding)}${right}`;
                  });

                  return [top, ...contentLines, bottom];
                },
                invalidate(): void {},
                handleInput(data: string): void {
                  if (
                    matchesKey(data, "escape") ||
                    matchesKey(data, "ctrl+c")
                  ) {
                    finish(undefined);
                    return;
                  }
                  if (
                    matchesKey(data, "shift+enter") ||
                    matchesKey(data, "alt+enter")
                  ) {
                    draft += "\n";
                    tui.requestRender();
                    return;
                  }
                  if (matchesKey(data, "enter")) {
                    finish(draft);
                    return;
                  }
                  if (matchesKey(data, "backspace")) {
                    draft = Array.from(draft).slice(0, -1).join("");
                    tui.requestRender();
                    return;
                  }
                  const kitty = decodeKittyPrintable(data);
                  if (kitty !== undefined) {
                    draft += kitty;
                    tui.requestRender();
                    return;
                  }
                  if (!data.startsWith("\x1b")) {
                    const validChars = Array.from(data)
                      .filter((c) => c >= " " || c === "\n")
                      .join("");
                    if (validChars.length > 0) {
                      draft += validChars;
                      tui.requestRender();
                      return;
                    }
                  }
                },
                dispose(): void {
                  finish(undefined);
                },
              };
            },
            {
              overlay: true,
              overlayOptions: {
                width: "70%",
                maxHeight: "75%",
                margin: 1,
              },
            },
          ),
        lockOptions,
      );
    } catch (error) {
      if (isAbortOrTimeout(error, lockOptions.signal)) return undefined;
      throw error;
    }
  }
  if (ctx.mode === "tui" && typeof ctx.ui?.editor === "function") {
    try {
      return await withPromptLock(() => ctx.ui.editor(title), lockOptions);
    } catch (error) {
      if (isAbortOrTimeout(error, lockOptions.signal)) return undefined;
      throw error;
    }
  }
  if (typeof ctx.ui?.input !== "function") return undefined;
  try {
    return await withPromptLock(
      () =>
        placeholder === undefined
          ? ctx.ui.input(title, undefined, dialogOptions(lockOptions))
          : ctx.ui.input(title, placeholder, dialogOptions(lockOptions)),
      lockOptions,
    );
  } catch (error) {
    if (isAbortOrTimeout(error, lockOptions.signal)) return undefined;
    throw error;
  }
}

export async function askQuestion(
  question: Question,
  ctx: ExtensionContext,
  options?: QuestionDialogOptions,
): Promise<QuestionAnswer | undefined> {
  const lockOptions = {
    signal: options?.signal ?? (ctx as { signal?: AbortSignal }).signal,
    timeoutMs: options?.timeoutMs,
  };
  if (question.mode === "free") {
    const answer = await askWriteIn(ctx, question.prompt, undefined, options);
    return answer === undefined
      ? undefined
      : { mode: "free", value: capAnswer(answer) };
  }

  if (question.mode === "multi") {
    const result = await askMulti(question, ctx, options);
    if (result === undefined || result.cancelled) return undefined;
    return {
      mode: "multi",
      selected: result.selected,
      writeIn: result.writeIn,
    };
  }

  if (typeof ctx.ui?.select !== "function") return undefined;
  let picked: string | undefined;
  try {
    picked = await withPromptLock(
      () =>
        ctx.ui.select(
          question.prompt,
          [...question.options, WRITE_IN_LABEL],
          dialogOptions(lockOptions),
        ),
      lockOptions,
    );
  } catch (error) {
    if (isAbortOrTimeout(error, lockOptions.signal)) return undefined;
    throw error;
  }
  if (picked === undefined) return undefined;
  if (picked !== WRITE_IN_LABEL) {
    return { mode: "single", value: picked };
  }

  const answer = await askWriteIn(
    ctx,
    question.prompt,
    "Custom answer",
    options,
  );
  return answer === undefined
    ? undefined
    : { mode: "single", value: capAnswer(answer) };
}

export const askSingleQuestion = askQuestion;

const NEXT_PAGE_LABEL = "Next page";
const BACK_LABEL = "Back";

export type AskQuestionsResult = (QuestionAnswer | undefined)[] & {
  cancelled?: boolean;
};

export async function askQuestions(
  questions: readonly Question[],
  ctx: ExtensionContext,
  options?: QuestionDialogOptions,
): Promise<AskQuestionsResult | undefined> {
  const answers: AskQuestionsResult = [];
  const pages = [
    ...new Set(questions.map((question) => question.page ?? 1)),
  ].sort((a, b) => a - b);
  let pageIndex = 0;
  const lockOptions = {
    signal: options?.signal ?? (ctx as { signal?: AbortSignal }).signal,
    timeoutMs: options?.timeoutMs,
  };

  while (pageIndex < pages.length) {
    const page = pages[pageIndex];
    if (page === undefined) break;
    const pageQuestions = questions
      .map((question, index) => ({ question, index }))
      .filter(({ question }) => (question.page ?? 1) === page);

    for (const { question, index } of pageQuestions) {
      if (!evaluateCondition(question.condition, answers)) continue;
      const answer = await askQuestion(question, ctx, options);
      if (answer === undefined) {
        answers.cancelled = true;
        return answers;
      }
      answers[index] = answer;
    }

    if (pageIndex === pages.length - 1) break;
    if (typeof ctx.ui?.select !== "function") {
      answers.cancelled = true;
      return answers;
    }
    let choice: string | undefined;
    try {
      choice = await withPromptLock(
        () =>
          ctx.ui.select(
            `Question page ${page} complete`,
            [NEXT_PAGE_LABEL, BACK_LABEL],
            dialogOptions(lockOptions),
          ),
        lockOptions,
      );
    } catch (error) {
      if (isAbortOrTimeout(error, lockOptions.signal)) {
        answers.cancelled = true;
        return answers;
      }
      throw error;
    }
    if (choice === undefined) {
      answers.cancelled = true;
      return answers;
    }
    if (choice === BACK_LABEL) {
      const previousPage = pages[pageIndex - 1];
      for (let index = 0; index < questions.length; index += 1) {
        const questionPage = questions[index]?.page ?? 1;
        if (
          questionPage === page ||
          (previousPage !== undefined && questionPage === previousPage)
        ) {
          answers[index] = undefined;
        }
      }
      pageIndex = Math.max(0, pageIndex - 1);
    } else {
      pageIndex += 1;
    }
  }

  return answers;
}

export const askQuestionFlow = askQuestions;

function extractAnswerText(answer: unknown): string | undefined {
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

interface QuestionSessionState {
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

function getQuestionSessionState(
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

function restoreFromEntries(entries: readonly unknown[]): QuestionSessionState {
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

export function createQuestionTool(pi?: ExtensionAPI) {
  return defineTool({
    name: "question",
    label: "question",
    description:
      "Ask the user one or more questions with single-select, multi-select, or free-text answers. Returns user responses.",
    exposure: "codemode",
    promptGuidelines: [
      "Use tools.question via codemode when you need clarification, user preferences, or decisions between alternatives instead of making blind assumptions.",
      "question is codemode-only: call it as tools.question({...}) inside a codemode script, never as a direct top-level tool.",
    ],
    parameters: Type.Object({
      questions: Type.Optional(
        Type.Array(
          Type.Union([
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
                  description:
                    "Optional page number for multi-page questionnaires.",
                }),
              ),
              condition: Type.Optional(
                Type.String({
                  description:
                    "Optional condition expression (e.g. \"answer1 == 'Yes'\").",
                }),
              ),
            }),
          ]),
        ),
      ),
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
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI || ctx.mode === "print" || ctx.mode === "json") {
        return {
          content: [
            {
              type: "text" as const,
              text: "Question requires an interactive session (TUI or RPC mode).",
            },
          ],
          details: { cancelled: true, answers: [], reason: "no-ui" },
        };
      }

      const rawQuestions =
        params.questions ??
        (params.prompt
          ? [
              {
                prompt: params.prompt,
                options: params.options,
                multi: params.multi,
              },
            ]
          : []);

      if (rawQuestions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No question prompt provided.",
            },
          ],
          details: { cancelled: true, answers: [] },
        };
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

      alertQuestion();

      const answers = await askQuestions(questions, ctx, { signal });
      if (signal?.aborted || answers === undefined || answers.cancelled) {
        return {
          content: [
            { type: "text" as const, text: "Question cancelled by user." },
          ],
          details: { cancelled: true, answers: answers ?? [] },
        };
      }

      const formatted = formatAnswers(answers);
      const now = Date.now();
      pi?.appendEntry?.(ANSWERS_TYPE, {
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

      return {
        content: [{ type: "text" as const, text: formatted }],
        details: { cancelled: false, answers },
      };
    },
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(createQuestionTool(pi));

  const restoreSession = (ctx?: ExtensionContext) => {
    if (!ctx) return;
    const entries =
      (typeof ctx.sessionManager?.getBranch === "function"
        ? ctx.sessionManager.getBranch()
        : typeof ctx.sessionManager?.getEntries === "function"
          ? ctx.sessionManager.getEntries()
          : []) ?? [];
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
  };

  pi.on("session_start", (_event, ctx) => {
    restoreSession(ctx);
    const active = pi.getActiveTools();
    const next = active.filter((name) => name !== "question");
    if (pi.getAllTools().some((tool) => tool.name === "codemode")) {
      if (!next.includes("codemode")) next.push("codemode");
    }
    if (
      next.length !== active.length ||
      next.some((name, index) => name !== active[index])
    ) {
      pi.setActiveTools(next);
    }
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreSession(ctx);
  });
}
