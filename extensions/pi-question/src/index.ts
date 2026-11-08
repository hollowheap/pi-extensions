import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  Text,
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { scanTaggedBlocks } from "@hollowheap/core/blocks";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { roundedFrame } from "@hollowheap/tui/frame";
import { alertQuestion } from "./alerts.js";
import {
  DONE_LABEL,
  type Question,
  type QuestionAnswer,
  WRITE_IN_LABEL,
  capAnswer,
  evaluateCondition,
  formatAnswers,
  parseQuestionBlock,
} from "./questions.js";

export const ANSWERS_TYPE = "hollowheap.question.answers";

const QUESTION_FORMAT = `Question blocks are tool-free. Use one only when the code or request cannot decide a choice, then end the turn without calling a tool.

End the turn with a fenced block:

'''question
## Which option?
1. First option
2. Second option
'''

Use one H2 per question; multiple questions are asked in source order. Every option is an ordered-list item. For multi-select, put [ ] on every option; for single-select, omit checkboxes. A question has 0-8 options; zero options asks for free text. Do not add a write-in option: the UI always appends "Write-in answer". Add [page: N] to group questions into pages with Next/Back navigation, and [if: answer1 == 'Yes'] to show a question only when an earlier answer matches. Answers arrive as a follow-up user message.`;

interface AnswerDetails {
  questions: Question[];
  answers: (QuestionAnswer | undefined)[];
  cancelled?: boolean;
}

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

              const finish = (result: MultiResult) => {
                if (finished) return;
                finished = true;
                done(result);
              };

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
        () => ctx.ui.select(question.prompt, rows),
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

              const finish = (value: string | undefined): void => {
                if (settled) return;
                settled = true;
                done(value);
              };

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
          ? ctx.ui.input(title)
          : ctx.ui.input(title, placeholder),
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
        ctx.ui.select(question.prompt, [...question.options, WRITE_IN_LABEL]),
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
          ctx.ui.select(`Question page ${page} complete`, [
            NEXT_PAGE_LABEL,
            BACK_LABEL,
          ]),
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

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      const block = part as { type?: unknown; text?: unknown };
      return block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join("\n");
}

function detailsText(details: unknown): string | undefined {
  if (details === null || typeof details !== "object") return undefined;
  const answers = (details as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return undefined;
  try {
    const formatted = formatAnswers(answers as QuestionAnswer[]);
    const cancelled = Boolean((details as { cancelled?: unknown }).cancelled);
    if (cancelled) {
      return formatted
        ? `${formatted}\n(Question dialog cancelled)`
        : "Question dialog cancelled";
    }
    return formatted || undefined;
  } catch {
    return undefined;
  }
}

function stripQuestionBlocks(markdown: string, isStreaming: boolean): string {
  const blocks = scanTaggedBlocks(markdown);
  let result = markdown;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.tag !== "question") continue;

    const remove = block.closed
      ? parseQuestionBlock(block.body) !== undefined
      : isStreaming;
    if (!remove) continue;

    const end = result[block.end] === "\n" ? block.end + 1 : block.end;
    result = result.slice(0, block.start) + result.slice(end);
  }

  return result;
}

export default function (pi: ExtensionAPI) {
  const handled = new WeakSet<object>();

  pi.registerMessageRenderer<AnswerDetails>(
    ANSWERS_TYPE,
    (message, options) => {
      const text = detailsText(message.details) ?? contentText(message.content);
      return new Text(text, options.outputPad, 0);
    },
  );

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant") return markdown;
    return stripQuestionBlocks(markdown, context.isStreaming);
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    event.systemPromptOptions.sections.question_format = QUESTION_FORMAT;
  });

  pi.on("message_end", async (event, ctx) => {
    if (!ctx.hasUI || event.message.role !== "assistant") return;
    if (handled.has(event.message)) return;

    try {
      const markdown = contentText(event.message.content);
      const questions: Question[] = [];
      for (const block of scanTaggedBlocks(markdown)) {
        if (block.tag !== "question" || !block.closed) continue;
        const parsed = parseQuestionBlock(block.body);
        if (parsed) questions.push(...parsed);
      }

      if (questions.length === 0) return;
      handled.add(event.message);
      alertQuestion();

      const answers = await askQuestions(questions, ctx, {
        signal: (ctx as { signal?: AbortSignal }).signal,
      });
      if ((ctx as { signal?: AbortSignal }).signal?.aborted) return;
      if (answers === undefined) return;

      if (answers.cancelled) {
        const partialText = formatAnswers(answers);
        const content = partialText
          ? `${partialText}\n(Question dialog cancelled)`
          : "Question dialog cancelled";
        pi.sendMessage(
          {
            customType: ANSWERS_TYPE,
            content,
            display: true,
            details: { questions, answers, cancelled: true },
          },
          { deliverAs: "followUp" },
        );
        return;
      }

      if (!answers.some((a) => a !== undefined)) return;

      pi.sendMessage(
        {
          customType: ANSWERS_TYPE,
          content: formatAnswers(answers),
          display: true,
          details: { questions, answers },
        },
        { deliverAs: "followUp" },
      );
    } catch (error) {
      handled.delete(event.message);
      ctx.ui?.notify?.(
        `pi-question: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  });
}
