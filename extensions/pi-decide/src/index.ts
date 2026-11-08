import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadDecideConfig } from "./config.js";
import { createDecideTool } from "./decide.js";

export default function (pi: ExtensionAPI): void {
  const diagnostics: string[] = [];
  loadDecideConfig(getAgentDir(), (message) => diagnostics.push(message));
  pi.registerTool(createDecideTool(pi));

  let reported = false;
  pi.on("session_start", (_event, ctx) => {
    if (reported || diagnostics.length === 0) return;
    reported = true;
    for (const message of diagnostics) {
      ctx.ui?.notify?.(`pi-decide: ${message}`, "warning");
    }
  });
}
