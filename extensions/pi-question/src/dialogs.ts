import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Text,
  decodeKittyPrintable,
  matchesKey,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import {
  canOverlay,
  editDialog,
  hostUi,
  inputDialog,
  selectDialog,
  showDialog,
} from "@hollowheap/pi-ui/host";
import {
  isAbortOrTimeout,
  scopedAbortSignal,
  watchAbort,
} from "@hollowheap/runtime/abort";
import { boxFrame, getFrameInnerWidth } from "@hollowheap/tui/frame";
import {
  DONE_LABEL,
  type Question,
  type QuestionAnswer,
  WRITE_IN_LABEL,
  capAnswer,
  evaluateCondition,
} from "./questions.js";
import { extractAnswerText } from "./session.js";
import {
  type QuestionDialogOptions,
  deleteBeforeCaret,
  dialogOptions,
  insertAtCaret,
  printableKey,
} from "./text.js";

interface MultiResult {
  selected: string[];
  writeIn?: string;
  cancelled: boolean;
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
  if (canOverlay(ctx)) {
    try {
      return await withPromptLock(
        () =>
          showDialog<MultiResult>(
            ctx,
            (tui, theme, _keybindings, done) => {
              const writeInRow = question.options.length;
              const doneRow = writeInRow + 1;
              const selected = new Set<number>();
              let cursor = 0;
              let editing = false;
              let writeIn = "";
              let draft = "";
              let caret = 0;
              let finished = false;

              const refresh = () => tui.requestRender();

              const dialogAbort = scopedAbortSignal(lockOptions);
              let stopWatching: () => void = () => {};
              const finish = (result: MultiResult) => {
                if (finished) return;
                finished = true;
                dialogAbort.stop();
                stopWatching();
                done(result);
              };

              stopWatching = watchAbort(dialogAbort.signal, () =>
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
                caret = Array.from(draft).length;
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
                    if (draft.length === 0) {
                      finish({
                        selected: [],
                        writeIn: undefined,
                        cancelled: true,
                      });
                    } else {
                      editing = false;
                      draft = "";
                      caret = 0;
                      refresh();
                    }
                    return;
                  }
                  if (matchesKey(data, Key.enter)) {
                    writeIn = capAnswer(draft);
                    editing = false;
                    cursor = doneRow;
                    refresh();
                    return;
                  }
                  if (matchesKey(data, Key.left)) {
                    caret = Math.max(0, caret - 1);
                    refresh();
                    return;
                  }
                  if (matchesKey(data, Key.right)) {
                    caret = Math.min(Array.from(draft).length, caret + 1);
                    refresh();
                    return;
                  }
                  if (matchesKey(data, Key.backspace)) {
                    const next = deleteBeforeCaret(draft, caret);
                    draft = next.text;
                    caret = next.caret;
                    refresh();
                    return;
                  }
                  const printable = printableKey(data);
                  if (printable !== undefined) {
                    const next = insertAtCaret(draft, caret, printable);
                    draft = capAnswer(next.text);
                    caret = Math.min(next.caret, Array.from(draft).length);
                    refresh();
                    return;
                  }
                  if (!data.startsWith("\x1b")) {
                    const pasted = Array.from(data)
                      .filter((c) => (c >= " " || c === "\n") && c !== "\x7f")
                      .join("");
                    if (pasted.length > 0) {
                      const next = insertAtCaret(draft, caret, pasted);
                      draft = capAnswer(next.text);
                      caret = Math.min(next.caret, Array.from(draft).length);
                      refresh();
                    }
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
                if (editing) {
                  const chars = Array.from(draft);
                  lines.push(
                    `❯ ${chars.slice(0, caret).join("")}█${chars.slice(caret).join("")}`,
                  );
                }
                lines.push(`${cursor === doneRow ? ">" : " "} Done`);
                lines.push("Space toggles • Enter selects • Esc cancels");
                const body = new Text(lines.join("\n"), 0, 0).render(
                  innerWidth,
                );
                return boxFrame(body, width, theme, question.prompt);
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
              switchPrompt: true,
              overlay: true,
              overlayOptions: {
                anchor: "bottom-center",
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

  if (typeof hostUi(ctx)?.select !== "function") return undefined;

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
        () =>
          selectDialog(
            ctx,
            question.prompt,
            rows,
            dialogOptions(ctx, lockOptions),
          ),
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
  if (canOverlay(ctx)) {
    try {
      return await withPromptLock(
        () =>
          showDialog<string | undefined>(
            ctx,
            (tui, theme, _keybindings, done) => {
              let draft = "";
              let caret = 0;
              let settled = false;
              let stopWatching: () => void = () => {};

              const dialogAbort = scopedAbortSignal(lockOptions);
              const finish = (value: string | undefined): void => {
                if (settled) return;
                settled = true;
                dialogAbort.stop();
                stopWatching();
                done(value);
              };

              stopWatching = watchAbort(dialogAbort.signal, () =>
                finish(undefined),
              );

              const insert = (value: string): void => {
                const next = insertAtCaret(draft, caret, value);
                draft = next.text;
                caret = next.caret;
                tui.requestRender();
              };

              const fg = (token: "muted" | "accent", val: string) =>
                typeof theme?.fg === "function" ? theme.fg(token, val) : val;

              return {
                render(width: number): string[] {
                  const chars = Array.from(draft);
                  const value =
                    draft.length === 0 && placeholder
                      ? `${fg("muted", placeholder)}█`
                      : `${chars.slice(0, caret).join("")}█${chars.slice(caret).join("")}`;
                  const content = new Text(
                    `${fg("accent", "❯")} ${value}`,
                    0,
                    0,
                  ).render(getFrameInnerWidth(width));
                  return boxFrame(
                    [
                      ...content.map((line) => line.trimEnd()),
                      fg(
                        "muted",
                        "Enter submits • Esc clears • Esc again cancels",
                      ),
                    ],
                    width,
                    theme,
                    title,
                  );
                },
                invalidate(): void {},
                handleInput(data: string): void {
                  if (matchesKey(data, "escape")) {
                    if (draft.length > 0) {
                      draft = "";
                      caret = 0;
                      tui.requestRender();
                      return;
                    }
                    finish(undefined);
                    return;
                  }
                  if (matchesKey(data, "ctrl+c")) {
                    finish(undefined);
                    return;
                  }
                  if (
                    matchesKey(data, "shift+enter") ||
                    matchesKey(data, "alt+enter")
                  ) {
                    insert("\n");
                    return;
                  }
                  if (matchesKey(data, "enter")) {
                    finish(draft);
                    return;
                  }
                  if (matchesKey(data, Key.left)) {
                    caret = Math.max(0, caret - 1);
                    tui.requestRender();
                    return;
                  }
                  if (matchesKey(data, Key.right)) {
                    caret = Math.min(Array.from(draft).length, caret + 1);
                    tui.requestRender();
                    return;
                  }
                  if (matchesKey(data, "backspace")) {
                    const next = deleteBeforeCaret(draft, caret);
                    draft = next.text;
                    caret = next.caret;
                    tui.requestRender();
                    return;
                  }
                  const kitty = decodeKittyPrintable(data);
                  if (kitty !== undefined) {
                    insert(kitty);
                    return;
                  }
                  if (!data.startsWith("\x1b")) {
                    const validChars = Array.from(data)
                      .filter((c) => c >= " " || c === "\n")
                      .join("");
                    if (validChars.length > 0) {
                      insert(validChars);
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
              switchPrompt: true,
              overlay: true,
              overlayOptions: {
                anchor: "bottom-center",
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
  if (ctx.mode === "tui" && typeof hostUi(ctx)?.editor === "function") {
    try {
      return await withPromptLock(() => editDialog(ctx, title), lockOptions);
    } catch (error) {
      if (isAbortOrTimeout(error, lockOptions.signal)) return undefined;
      throw error;
    }
  }
  if (typeof hostUi(ctx)?.input !== "function") return undefined;
  try {
    return await withPromptLock(
      () =>
        placeholder === undefined
          ? inputDialog(ctx, title, undefined, dialogOptions(ctx, lockOptions))
          : inputDialog(
              ctx,
              title,
              placeholder,
              dialogOptions(ctx, lockOptions),
            ),
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

  if (typeof hostUi(ctx)?.select !== "function") return undefined;
  let picked: string | undefined;
  try {
    picked = await withPromptLock(
      () =>
        selectDialog(
          ctx,
          question.prompt,
          [...question.options, WRITE_IN_LABEL],
          dialogOptions(ctx, lockOptions),
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

interface ReviewEditAction {
  editIndex: number;
}

const REVIEW_ACTIONS = ["Edit", "Confirm", "Cancel"] as const;

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
    if (typeof hostUi(ctx)?.select !== "function") {
      answers.cancelled = true;
      return answers;
    }
    let choice: string | undefined;
    try {
      choice = await withPromptLock(
        () =>
          selectDialog(
            ctx,
            `Question page ${page} complete`,
            [NEXT_PAGE_LABEL, BACK_LABEL],
            dialogOptions(ctx, lockOptions),
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

  if (answers.length > 0 && canOverlay(ctx)) {
    for (;;) {
      let review: AskQuestionsResult | ReviewEditAction | undefined;
      try {
        review = await withPromptLock(
          () =>
            showDialog<AskQuestionsResult | ReviewEditAction>(
              ctx,
              (tui, _theme, _keybindings, done) => {
                let questionCursor = 0;
                let actionCursor = 1;
                let settled = false;
                const settle = (
                  value: AskQuestionsResult | ReviewEditAction,
                ) => {
                  if (settled) return;
                  settled = true;
                  done(value);
                };
                const cancel = () => {
                  const cancelled = [...answers] as AskQuestionsResult;
                  cancelled.cancelled = true;
                  settle(cancelled);
                };
                const answerLines = Array.from(
                  answers,
                  (answer, index) =>
                    `${index + 1}. ${extractAnswerText(answer) ?? "no answer"}`,
                );
                return {
                  render(width: number): string[] {
                    const limit = Math.max(1, width);
                    const lines = ["Review", ""];
                    answerLines.forEach((line, index) => {
                      lines.push(
                        `${index === questionCursor ? ">" : " "} ${line}`,
                      );
                    });
                    lines.push("");
                    lines.push(
                      REVIEW_ACTIONS.map(
                        (action, index) =>
                          `${index === actionCursor ? "[" : " "}${action}${index === actionCursor ? "]" : " "}`,
                      ).join("   "),
                    );
                    return lines.map((line) => line.slice(0, limit));
                  },
                  invalidate: () => {},
                  handleInput(data: string): void {
                    if (matchesKey(data, Key.escape)) {
                      cancel();
                      return;
                    }
                    if (matchesKey(data, Key.enter)) {
                      if (actionCursor === 0) {
                        settle({ editIndex: questionCursor });
                      } else if (actionCursor === 1) {
                        settle(answers);
                      } else {
                        cancel();
                      }
                      return;
                    }
                    if (matchesKey(data, Key.up)) {
                      questionCursor = Math.max(0, questionCursor - 1);
                      tui.requestRender();
                      return;
                    }
                    if (matchesKey(data, Key.down)) {
                      questionCursor = Math.min(
                        Math.max(0, answerLines.length - 1),
                        questionCursor + 1,
                      );
                      tui.requestRender();
                      return;
                    }
                    if (matchesKey(data, Key.left)) {
                      actionCursor =
                        (actionCursor + REVIEW_ACTIONS.length - 1) %
                        REVIEW_ACTIONS.length;
                      tui.requestRender();
                      return;
                    }
                    if (matchesKey(data, Key.right)) {
                      actionCursor = (actionCursor + 1) % REVIEW_ACTIONS.length;
                      tui.requestRender();
                    }
                  },
                  dispose: () => cancel(),
                };
              },
              {
                switchPrompt: true,
                overlay: true,
                overlayOptions: {
                  anchor: "bottom-center",
                  width: "70%",
                  maxHeight: "75%",
                  margin: 1,
                },
              },
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

      if (review === undefined) return answers;
      if ("editIndex" in review) {
        const question = questions[review.editIndex];
        if (question === undefined) continue;
        const answer = await askQuestion(question, ctx, options);
        if (answer === undefined) {
          answers.cancelled = true;
          return answers;
        }
        answers[review.editIndex] = answer;
        continue;
      }
      return review;
    }
  }

  return answers;
}

export const askQuestionFlow = askQuestions;
