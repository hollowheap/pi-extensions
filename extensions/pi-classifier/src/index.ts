import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadClassifierConfig } from "./config.js";
import { createDecideTool, defaultClassify } from "./decide.js";

export default function (pi: ExtensionAPI): void {
  const diagnostics: string[] = [];
  const config = loadClassifierConfig(getAgentDir(), (message) =>
    diagnostics.push(message),
  );
  pi.registerTool(
    createDecideTool({
      loadConfig: () => config,
      getAgentDir,
      classify: defaultClassify,
    }),
  );

  let reported = false;
  pi.on("session_start", (_event, ctx) => {
    if (reported || diagnostics.length === 0) return;
    reported = true;
    for (const message of diagnostics) {
      ctx.ui.notify(`pi-classifier: ${message}`, "warning");
    }
  });
}
