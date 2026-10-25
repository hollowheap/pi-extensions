import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadCodeIntelConfig } from "./config.js";
import { disposeAllLspClients } from "./lsp.js";
import { createCodeIntelTool } from "./tool.js";

export default function (pi: ExtensionAPI) {
  const diagnostics: string[] = [];
  const config = loadCodeIntelConfig(getAgentDir(), (message) =>
    diagnostics.push(message),
  );
  if (config.exposure !== "hidden") {
    pi.registerTool(createCodeIntelTool({}, config.exposure));
  }

  let reported = false;
  pi.on("session_start", (_event, ctx) => {
    void disposeAllLspClients();
    if (!reported && diagnostics.length > 0) {
      reported = true;
      for (const message of diagnostics) {
        ctx.ui.notify(`pi-code-intel: ${message}`, "warning");
      }
    }
    if (config.exposure !== "codemode") return;
    if (!pi.getAllTools().some((tool) => tool.name === "codemode")) return;
    const active = pi.getActiveTools();
    if (active.includes("codemode")) return;
    pi.setActiveTools([...active, "codemode"]);
  });

  pi.on("session_shutdown", () => {
    void disposeAllLspClients();
  });
}
