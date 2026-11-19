import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { restoreQuestionSession } from "./session.js";
import { createQuestionTool } from "./tool.js";

export { ANSWERS_TYPE } from "./session.js";
export {
  askQuestion,
  askQuestionFlow,
  askQuestions,
  askSingleQuestion,
  type AskQuestionsResult,
} from "./dialogs.js";
export type { QuestionDialogOptions } from "./text.js";
export { createQuestionTool } from "./tool.js";

export default function (pi: ExtensionAPI): void {
  pi.registerTool(createQuestionTool(pi));

  pi.on("session_start", (_event, ctx) => {
    restoreQuestionSession(ctx);
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
    restoreQuestionSession(ctx);
  });
}
