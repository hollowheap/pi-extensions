import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  type Focusable,
  Key,
  SelectList,
  type TUI,
  Text,
  isFocusable,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import {
  canOverlay,
  hostUi,
  inputDialog,
  selectDialog,
  showDialog,
} from "@hollowheap/pi-ui/host";
import { selectListTheme } from "@hollowheap/pi-ui/picker";
import {
  isAbortOrTimeout,
  scopedAbortSignal,
  watchAbort,
} from "@hollowheap/runtime/abort";
import { boxFrame, getFrameInnerWidth } from "@hollowheap/ui/frame";
import {
  type DialogTab,
  TabbedContent,
  formatSelectedLabel,
} from "@hollowheap/ui/tabs";
import { safeFg } from "@hollowheap/ui/theme";
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

type LockedDialogComponent = Component & {
  focused?: boolean;
  dispose?(): void;
};

async function showLockedDialog<T>(
  ctx: ExtensionContext,
  lockOptions: QuestionDialogOptions,
  create: (helpers: {
    tui: TUI;
    theme: Theme;
    finish: (value: T) => void;
    cancel: () => void;
  }) => LockedDialogComponent,
  onCancelValue: () => T,
): Promise<T | undefined> {
  let overlayHandle: { focus(): void; unfocus(): void } | undefined;
  let mainPromptFocused = false;
  try {
    return await withPromptLock(
      () =>
        showDialog<T>(
          ctx,
          (tui, theme, _keybindings, done) => {
            let settled = false;
            const dialogAbort = scopedAbortSignal(lockOptions);
            let stopWatching: () => void = () => {};
            const finish = (value: T): void => {
              if (settled) return;
              settled = true;
              dialogAbort.stop();
              stopWatching();
              done(value);
            };
            const cancel = (): void => finish(onCancelValue());
            stopWatching = watchAbort(dialogAbort.signal, cancel);
            const component = create({ tui, theme, finish, cancel });
            const wrapper: LockedDialogComponent = {
              render: (width) => {
                const dialogWidth = Math.min(
                  width,
                  Math.max(20, Math.floor(width * 0.7)),
                );
                const padding = Math.max(
                  0,
                  Math.floor((width - dialogWidth) / 2),
                );
                return component
                  .render(dialogWidth)
                  .map((line) => `${" ".repeat(padding)}${line}`);
              },
              invalidate: () => component.invalidate(),
              handleInput: (data) => {
                if (matchesKey(data, Key.shift("left"))) {
                  mainPromptFocused = !mainPromptFocused;
                  if (mainPromptFocused) overlayHandle?.unfocus();
                  else overlayHandle?.focus();
                  return;
                }
                return component.handleInput?.(data);
              },
              dispose: () => {
                component.dispose?.();
                cancel();
              },
            };
            if (isFocusable(component)) {
              Object.defineProperty(wrapper, "focused", {
                enumerable: true,
                get: () => component.focused,
                set: (value: boolean) => {
                  component.focused = value;
                },
              });
            }
            return wrapper;
          },
          {
            overlay: false,
            onHandle: (handle) => {
              overlayHandle = handle;
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

function createEditor(
  tui: TUI,
  theme: Theme | undefined,
  prefill: string | undefined,
  onSubmit: (value: string) => void,
): Editor {
  const fg = (text: string) => safeFg(theme, "border", text);
  const editorTui = tui.terminal
    ? tui
    : ({ ...tui, terminal: { rows: 24, columns: 80 } } as TUI);
  const editor = new Editor(editorTui, {
    borderColor: fg,
    selectList: {
      selectedPrefix: fg,
      selectedText: fg,
      description: fg,
      scrollInfo: fg,
      noMatch: fg,
    },
  });
  if (prefill !== undefined) editor.setText(prefill);
  editor.onSubmit = onSubmit;
  return editor;
}

function createMultiSelectComponent(
  question: Question,
  theme: Theme | undefined,
  requestRender: () => void,
  handlers: {
    onSubmit: (result: MultiResult) => void;
    onCancel: () => void;
    showFrame: boolean;
  },
): Component {
  const writeInRow = question.options.length;
  const doneRow = writeInRow + 1;
  const selected = new Set<number>();
  let cursor = 0;
  let editing = false;
  let writeIn = "";
  let draft = "";
  let caret = 0;

  const submit = () => {
    handlers.onSubmit({
      selected: question.options.filter((_, index) => selected.has(index)),
      writeIn: writeIn.length === 0 ? undefined : writeIn,
      cancelled: false,
    });
  };

  const startEditing = () => {
    editing = true;
    cursor = writeInRow;
    draft = writeIn;
    caret = Array.from(draft).length;
    requestRender();
  };

  const toggle = (index: number) => {
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    requestRender();
  };

  const handleInput = (data: string) => {
    if (editing) {
      if (matchesKey(data, Key.escape)) {
        if (draft.length === 0) {
          handlers.onCancel();
        } else {
          editing = false;
          draft = "";
          caret = 0;
          requestRender();
        }
        return;
      }
      if (matchesKey(data, Key.enter)) {
        writeIn = capAnswer(draft);
        editing = false;
        cursor = doneRow;
        requestRender();
        return;
      }
      if (matchesKey(data, Key.left)) {
        caret = Math.max(0, caret - 1);
        requestRender();
        return;
      }
      if (matchesKey(data, Key.right)) {
        caret = Math.min(Array.from(draft).length, caret + 1);
        requestRender();
        return;
      }
      if (matchesKey(data, Key.backspace)) {
        const next = deleteBeforeCaret(draft, caret);
        draft = next.text;
        caret = next.caret;
        requestRender();
        return;
      }
      const printable = printableKey(data);
      if (printable !== undefined) {
        const next = insertAtCaret(draft, caret, printable);
        draft = capAnswer(next.text);
        caret = Math.min(next.caret, Array.from(draft).length);
        requestRender();
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
          requestRender();
        }
      }
      return;
    }

    if (matchesKey(data, Key.escape)) {
      handlers.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      cursor = Math.max(0, cursor - 1);
      requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      cursor = Math.min(doneRow, cursor + 1);
      requestRender();
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
    const innerWidth = handlers.showFrame
      ? getFrameInnerWidth(width)
      : Math.max(1, width);
    const lines: string[] = [];
    if (!handlers.showFrame) {
      lines.push(sanitizeTerminalText(question.prompt), "");
    }
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
    const body = new Text(lines.join("\n"), 0, 0).render(innerWidth);
    return handlers.showFrame
      ? boxFrame(body, width, theme as Theme, question.prompt)
      : body;
  };

  return {
    render,
    invalidate: () => {},
    handleInput,
  };
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
    return showLockedDialog<MultiResult>(
      ctx,
      lockOptions,
      ({ tui, theme, finish, cancel }) =>
        createMultiSelectComponent(question, theme, () => tui.requestRender(), {
          onSubmit: finish,
          onCancel: cancel,
          showFrame: true,
        }),
      () => ({ selected: [], writeIn: undefined, cancelled: true }),
    );
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
  prefill?: string,
): Promise<string | undefined> {
  const lockOptions = {
    signal: options?.signal ?? (ctx as { signal?: AbortSignal }).signal,
    timeoutMs: options?.timeoutMs,
  };
  if (
    !lockOptions.signal &&
    lockOptions.timeoutMs === undefined &&
    ctx.mode === "tui" &&
    typeof hostUi(ctx)?.editor === "function"
  ) {
    try {
      return await withPromptLock(
        () => hostUi(ctx).editor(title, prefill),
        lockOptions,
      );
    } catch (error) {
      if (isAbortOrTimeout(error, lockOptions.signal)) return undefined;
      throw error;
    }
  }
  if (canOverlay(ctx)) {
    return showLockedDialog<string | undefined>(
      ctx,
      lockOptions,
      ({ tui, theme, finish, cancel }) => {
        const editor = createEditor(tui, theme, prefill, finish);

        return {
          get focused() {
            return editor.focused;
          },
          set focused(focused) {
            editor.focused = focused;
          },
          render(width: number): string[] {
            const innerWidth = getFrameInnerWidth(width);
            const hint = safeFg(
              theme,
              "muted",
              "Enter submits • Esc clears • Esc again cancels",
            );
            return boxFrame(
              [...editor.render(innerWidth), hint],
              width,
              theme,
              sanitizeTerminalText(title),
            );
          },
          invalidate(): void {
            editor.invalidate();
          },
          handleInput(data: string): void {
            if (matchesKey(data, Key.escape)) {
              if (editor.getText().length > 0) {
                editor.setText("");
                tui.requestRender();
                return;
              }
              cancel();
              return;
            }
            if (matchesKey(data, Key.ctrl("c"))) {
              cancel();
              return;
            }
            editor.handleInput(data);
            tui.requestRender();
          },
        };
      },
      () => undefined,
    );
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

  if (!canOverlay(ctx) && typeof hostUi(ctx)?.select !== "function") {
    return undefined;
  }
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

function createReviewComponent(
  count: number,
  getAnswer: (index: number) => QuestionAnswer | undefined,
  requestRender: () => void,
  handlers: {
    onEdit: (index: number) => void;
    onConfirm: () => void;
    onCancel: () => void;
  },
): Component {
  let questionCursor = 0;
  let actionCursor = 1;

  return {
    render(width: number): string[] {
      const limit = Math.max(1, width);
      const lines = ["Review", ""];
      for (let index = 0; index < count; index += 1) {
        const text = extractAnswerText(getAnswer(index)) ?? "no answer";
        lines.push(
          `${index === questionCursor ? ">" : " "} ${index + 1}. ${text}`,
        );
      }
      lines.push("");
      lines.push(
        REVIEW_ACTIONS.map((action, index) =>
          formatSelectedLabel(action, index === actionCursor),
        ).join("   "),
      );
      return lines.map((line) => truncateToWidth(line, limit, ""));
    },
    invalidate: () => {},
    handleInput(data: string): void {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
        handlers.onCancel();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        if (actionCursor === 0) {
          actionCursor = 1;
          handlers.onEdit(questionCursor);
        } else if (actionCursor === 1) {
          handlers.onConfirm();
        } else {
          handlers.onCancel();
        }
        return;
      }
      if (matchesKey(data, Key.up)) {
        questionCursor = Math.max(0, questionCursor - 1);
        requestRender();
        return;
      }
      if (matchesKey(data, Key.down)) {
        questionCursor = Math.min(Math.max(0, count - 1), questionCursor + 1);
        requestRender();
        return;
      }
      if (matchesKey(data, Key.left)) {
        actionCursor =
          (actionCursor + REVIEW_ACTIONS.length - 1) % REVIEW_ACTIONS.length;
        requestRender();
        return;
      }
      if (matchesKey(data, Key.right)) {
        actionCursor = (actionCursor + 1) % REVIEW_ACTIONS.length;
        requestRender();
      }
    },
  };
}

function createFreeQuestionTab(
  question: Question,
  tui: TUI,
  theme: Theme | undefined,
  onAnswer: (answer: QuestionAnswer) => void,
  onCancel: () => void,
): Component & Focusable {
  const editor = createEditor(tui, theme, undefined, (value) =>
    onAnswer({ mode: "free", value: capAnswer(value) }),
  );
  return {
    get focused(): boolean {
      return editor.focused;
    },
    set focused(value: boolean) {
      editor.focused = value;
    },
    render(width: number): string[] {
      const hint = safeFg(
        theme,
        "muted",
        "Enter submits • Esc clears • Esc again cancels",
      );
      return [
        sanitizeTerminalText(question.prompt),
        "",
        ...editor.render(Math.max(1, width)),
        hint,
      ];
    },
    invalidate: () => editor.invalidate(),
    handleInput(data: string): void {
      if (matchesKey(data, Key.escape)) {
        if (editor.getText().length > 0) {
          editor.setText("");
          tui.requestRender();
          return;
        }
        onCancel();
        return;
      }
      editor.handleInput(data);
      tui.requestRender();
    },
  };
}

function createSingleQuestionTab(
  question: Question,
  tui: TUI,
  theme: Theme | undefined,
  onAnswer: (answer: QuestionAnswer) => void,
  onCancel: () => void,
): Component & Focusable {
  const rows = [...question.options, WRITE_IN_LABEL];
  const list = new SelectList(
    rows.map((value) => ({ value, label: sanitizeTerminalText(value) })),
    Math.max(1, Math.min(8, rows.length)),
    selectListTheme(theme, true, "dim"),
  );
  let focused = false;
  let editingWriteIn = false;
  const editor = createEditor(tui, theme, undefined, (value) => {
    editingWriteIn = false;
    editor.focused = false;
    onAnswer({ mode: "single", value: capAnswer(value) });
  });

  list.onSelect = (item) => {
    if (item.value === WRITE_IN_LABEL) {
      editingWriteIn = true;
      editor.focused = focused;
      tui.requestRender();
      return;
    }
    onAnswer({ mode: "single", value: item.value });
  };

  return {
    get focused(): boolean {
      return focused;
    },
    set focused(value: boolean) {
      focused = value;
      editor.focused = value && editingWriteIn;
    },
    render(width: number): string[] {
      const content = editingWriteIn
        ? [
            ...editor.render(Math.max(1, width)),
            safeFg(theme, "muted", "Enter submits • Esc goes back"),
          ]
        : list.render(Math.max(1, width));
      return [sanitizeTerminalText(question.prompt), "", ...content];
    },
    invalidate(): void {
      list.invalidate();
      editor.invalidate();
    },
    handleInput(data: string): void {
      if (editingWriteIn) {
        if (matchesKey(data, Key.escape)) {
          if (editor.getText().length > 0) {
            editor.setText("");
          } else {
            editingWriteIn = false;
            editor.focused = false;
          }
          tui.requestRender();
          return;
        }
        editor.handleInput(data);
        tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.escape)) {
        onCancel();
        return;
      }
      list.handleInput(data);
      tui.requestRender();
    },
  };
}

async function askTabbedQuestions(
  questions: readonly Question[],
  ctx: ExtensionContext,
  lockOptions: QuestionDialogOptions,
): Promise<AskQuestionsResult> {
  const answers: AskQuestionsResult = [];
  const ordered = questions
    .map((question, originalIndex) => ({ question, originalIndex }))
    .sort((a, b) => (a.question.page ?? 1) - (b.question.page ?? 1));

  const result = await showLockedDialog<AskQuestionsResult>(
    ctx,
    lockOptions,
    ({ tui, theme, finish, cancel }) => {
      const reviewIndex = ordered.length;
      const tabCount = ordered.length + 1;

      const isTabVisible = (tabIndex: number): boolean => {
        if (tabIndex === reviewIndex) return true;
        const entry = ordered[tabIndex];
        return (
          entry !== undefined &&
          evaluateCondition(entry.question.condition, answers)
        );
      };

      const clearHiddenAnswers = (): void => {
        for (const entry of ordered) {
          if (!evaluateCondition(entry.question.condition, answers)) {
            answers[entry.originalIndex] = undefined;
          }
        }
      };

      const nextVisibleTab = (fromIndex: number): number => {
        for (let next = fromIndex + 1; next < ordered.length; next += 1) {
          if (isTabVisible(next)) return next;
        }
        return reviewIndex;
      };

      const stepVisibleTab = (fromIndex: number, direction: 1 | -1): number => {
        for (let offset = 1; offset <= tabCount; offset += 1) {
          const candidate =
            (fromIndex + direction * offset + tabCount) % tabCount;
          if (isTabVisible(candidate)) return candidate;
        }
        return reviewIndex;
      };

      const tabs: DialogTab[] = ordered.map(
        ({ question, originalIndex }, tabIndex) => {
          const submitAnswer = (answer: QuestionAnswer) => {
            if (!isTabVisible(tabIndex)) return;
            answers[originalIndex] = answer;
            clearHiddenAnswers();
            switchToTab(nextVisibleTab(tabIndex));
          };
          const content: Component =
            question.mode === "free"
              ? createFreeQuestionTab(
                  question,
                  tui,
                  theme,
                  submitAnswer,
                  cancel,
                )
              : question.mode === "multi"
                ? createMultiSelectComponent(
                    question,
                    theme,
                    () => tui.requestRender(),
                    {
                      onSubmit: (multiResult) =>
                        submitAnswer({
                          mode: "multi",
                          selected: multiResult.selected,
                          writeIn: multiResult.writeIn,
                        }),
                      onCancel: cancel,
                      showFrame: false,
                    },
                  )
                : createSingleQuestionTab(
                    question,
                    tui,
                    theme,
                    submitAnswer,
                    cancel,
                  );
          return { label: `Q${tabIndex + 1}`, content };
        },
      );

      tabs.push({
        label: "Review",
        content: createReviewComponent(
          questions.length,
          (index) => answers[index],
          () => tui.requestRender(),
          {
            onEdit: (editIndex) =>
              switchToTab(
                ordered.findIndex((entry) => entry.originalIndex === editIndex),
              ),
            onConfirm: () => finish(answers),
            onCancel: cancel,
          },
        ),
      });

      const tabbed = new TabbedContent(tabs, (label, active) => {
        const colored = safeFg(theme, active ? "accent" : "muted", label);
        return active && typeof theme?.bold === "function"
          ? theme.bold(colored)
          : colored;
      });
      tabbed.setActiveIndex(nextVisibleTab(-1));

      const switchToTab = (target: number) => {
        if (target < 0 || target >= tabCount || !isTabVisible(target)) return;
        tabbed.setActiveIndex(target);
        tui.requestRender();
      };

      return {
        get focused(): boolean {
          return tabbed.focused;
        },
        set focused(value: boolean) {
          tabbed.focused = value;
        },
        render(width: number): string[] {
          const body = tabbed.render(getFrameInnerWidth(width));
          return boxFrame(body, width, theme, "Questions");
        },
        invalidate: () => tabbed.invalidate(),
        handleInput(data: string): void {
          if (matchesKey(data, Key.ctrl("c"))) {
            cancel();
            return;
          }
          const backward = matchesKey(data, Key.shift("tab"));
          if (backward || matchesKey(data, Key.tab)) {
            switchToTab(stepVisibleTab(tabbed.activeIndex, backward ? -1 : 1));
            return;
          }
          tabbed.handleInput(data);
        },
      };
    },
    () => {
      const cancelled = [...answers] as AskQuestionsResult;
      cancelled.cancelled = true;
      return cancelled;
    },
  );
  if (result === undefined) {
    answers.cancelled = true;
    return answers;
  }
  return result;
}

export async function askQuestions(
  questions: readonly Question[],
  ctx: ExtensionContext,
  options?: QuestionDialogOptions,
): Promise<AskQuestionsResult | undefined> {
  if (questions.length === 0) return [];
  const lockOptions = {
    signal: options?.signal ?? (ctx as { signal?: AbortSignal }).signal,
    timeoutMs: options?.timeoutMs,
  };

  if (canOverlay(ctx) && questions.length > 1) {
    return askTabbedQuestions(questions, ctx, lockOptions);
  }

  const answers: AskQuestionsResult = [];
  const pages = [
    ...new Set(questions.map((question) => question.page ?? 1)),
  ].sort((a, b) => a - b);
  let pageIndex = 0;

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
      const review = await showLockedDialog<
        AskQuestionsResult | ReviewEditAction
      >(
        ctx,
        lockOptions,
        ({ tui, finish, cancel }) =>
          createReviewComponent(
            answers.length,
            (index) => answers[index],
            () => tui.requestRender(),
            {
              onEdit: (editIndex) => finish({ editIndex }),
              onConfirm: () => finish(answers),
              onCancel: cancel,
            },
          ),
        () => {
          const cancelled = [...answers] as AskQuestionsResult;
          cancelled.cancelled = true;
          return cancelled;
        },
      );

      if (review === undefined) {
        answers.cancelled = true;
        return answers;
      }
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
