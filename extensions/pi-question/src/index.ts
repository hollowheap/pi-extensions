import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  Text,
  decodeKittyPrintable,
  matchesKey,
} from "@earendil-works/pi-tui";
import { scanTaggedBlocks, withPromptLock } from "@hollowheap/core";
import {
  type Question,
  type QuestionAnswer,
  WRITE_IN_LABEL,
  capAnswer,
  evaluateCondition,
  formatAnswers,
  parseQuestionBlock,
} from "./questions.js";

const ANSWERS_TYPE = "hollowheap.question.answers";

const QUESTION_FORMAT = `Question blocks are tool-free. Use one only when the code or request cannot decide a choice, then end the turn without calling a tool.

End the turn with a fenced block:

'''question
## Which option?
1. First option
2. Second option
'''

Use one H2 per question; multiple questions are asked in source order. Every option is an ordered-list item. For multi-select, put [ ] on every option; for single-select, omit checkboxes. A question has 0-8 options; zero options asks for free text. Do not add a write-in option: the UI always appends "Write-in answer". Answers arrive as a follow-up user message.`;

interface AnswerDetails {
  questions: Question[];
  answers: QuestionAnswer[];
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

async function askMulti(
  question: Question,
  ctx: ExtensionContext,
): Promise<MultiResult | undefined> {
  if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
    return withPromptLock(() =>
      ctx.ui.custom<MultiResult>((tui, _theme, _keybindings, done) => {
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
              draft = draft.slice(0, -1);
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
          const lines = [question.prompt];
          question.options.forEach((option, index) => {
            const pointer = cursor === index ? ">" : " ";
            const mark = selected.has(index) ? "x" : " ";
            lines.push(`${pointer} [${mark}] ${option}`);
          });
          const pointer = cursor === writeInRow ? ">" : " ";
          const suffix = writeIn.length === 0 ? "" : `: ${writeIn}`;
          lines.push(`${pointer} [ ] ${WRITE_IN_LABEL}${suffix}`);
          if (editing) lines.push(`  ${draft}█`);
          lines.push(`${cursor === doneRow ? ">" : " "} Done`);
          lines.push("Space toggles • Enter selects • Esc cancels");
          return new Text(lines.join("\n"), 0, 0).render(width);
        };

        return {
          render,
          invalidate: () => {},
          handleInput,
        };
      }),
    );
  }

  const selected = new Set<number>();
  let writeIn: string | undefined;

  for (;;) {
    const rows = [
      ...question.options.map(
        (option, index) => `${selected.has(index) ? "[x]" : "[ ]"} ${option}`,
      ),
      WRITE_IN_LABEL,
      "Done",
    ];
    const picked = await withPromptLock(() =>
      ctx.ui.select(question.prompt, rows),
    );
    if (picked === undefined) return undefined;

    if (picked === "Done") {
      return {
        selected: question.options.filter((_, index) => selected.has(index)),
        writeIn,
        cancelled: false,
      };
    }

    if (picked === WRITE_IN_LABEL) {
      const answer = await withPromptLock(() =>
        ctx.ui.input(question.prompt, "Custom answer"),
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

async function askQuestion(
  question: Question,
  ctx: ExtensionContext,
): Promise<QuestionAnswer | undefined> {
  if (question.mode === "free") {
    const answer = await withPromptLock(() => ctx.ui.input(question.prompt));
    return answer === undefined
      ? undefined
      : { mode: "free", value: capAnswer(answer) };
  }

  if (question.mode === "multi") {
    const result = await askMulti(question, ctx);
    if (result === undefined || result.cancelled) return undefined;
    return {
      mode: "multi",
      selected: result.selected,
      writeIn: result.writeIn,
    };
  }

  const picked = await withPromptLock(() =>
    ctx.ui.select(question.prompt, [...question.options, WRITE_IN_LABEL]),
  );
  if (picked === undefined) return undefined;
  if (picked !== WRITE_IN_LABEL) {
    return { mode: "single", value: picked };
  }

  const answer = await withPromptLock(() =>
    ctx.ui.input(question.prompt, "Custom answer"),
  );
  return answer === undefined
    ? undefined
    : { mode: "single", value: capAnswer(answer) };
}

async function askQuestions(
  questions: readonly Question[],
  ctx: ExtensionContext,
): Promise<QuestionAnswer[] | undefined> {
  const answers: QuestionAnswer[] = [];
  for (const question of questions) {
    if (!evaluateCondition(question.condition, answers)) continue;
    const answer = await askQuestion(question, ctx);
    if (answer === undefined) return undefined;
    answers.push(answer);
  }
  return answers;
}

function contentText(
  content: string | readonly { type: string; text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n");
}

function detailsText(details: unknown): string | undefined {
  if (details === null || typeof details !== "object") return undefined;
  const answers = (details as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return undefined;
  try {
    return formatAnswers(answers as QuestionAnswer[]) || undefined;
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

    const markdown = event.message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");

    const questions: Question[] = [];
    for (const block of scanTaggedBlocks(markdown)) {
      if (block.tag !== "question" || !block.closed) continue;
      const parsed = parseQuestionBlock(block.body);
      if (parsed) questions.push(...parsed);
    }

    if (questions.length === 0 || handled.has(event.message)) return;
    handled.add(event.message);

    const answers = await askQuestions(questions, ctx);
    if (answers === undefined || answers.length === 0) return;

    pi.sendMessage(
      {
        customType: ANSWERS_TYPE,
        content: formatAnswers(answers),
        display: true,
        details: { questions, answers },
      },
      { deliverAs: "followUp" },
    );
  });
}
