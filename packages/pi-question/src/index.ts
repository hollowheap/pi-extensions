import { Type } from "@earendil-works/pi-ai";
import { type ExtensionAPI, defineTool } from "@earendil-works/pi-coding-agent";

const FREE_TEXT = "Other (free-text answer)";
const MAX_ANSWER = 500;

const questionTool = defineTool({
  name: "question",
  label: "Question",
  description:
    "Ask the user one question and wait for the answer. Use only when a choice cannot be decided from the code or the request.",
  parameters: Type.Object({
    question: Type.String({ description: "The question to ask the user" }),
    options: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Choices to offer, 2 to 4 items; a free-text answer is always allowed",
      }),
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    if (
      typeof ctx.ui?.select !== "function" ||
      typeof ctx.ui?.input !== "function"
    ) {
      throw new Error(
        "question requires an interactive UI with select and input dialogs",
      );
    }
    let answer: string | undefined;
    if (params.options === undefined) {
      answer = await ctx.ui.input(params.question);
    } else {
      if (params.options.length < 2 || params.options.length > 4) {
        throw new Error("question options must contain 2 to 4 items");
      }
      const picked = await ctx.ui.select(params.question, [
        ...params.options,
        FREE_TEXT,
      ]);
      if (picked === undefined) {
        throw new Error("question dismissed without an answer");
      }
      answer =
        picked === FREE_TEXT
          ? await ctx.ui.input(params.question, "Custom answer")
          : picked;
    }
    if (answer === undefined) {
      throw new Error("question dismissed without an answer");
    }
    const capped = answer.slice(0, MAX_ANSWER);
    return {
      content: [{ type: "text", text: capped }],
      details: { question: params.question, answer: capped },
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(questionTool);
}
