import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadLanguageToolsConfig } from "./config.js";
import { disposeAllLspClients } from "./lsp.js";
import { createLangTool } from "./tool.js";

export default function (pi: ExtensionAPI) {
  const diagnostics: string[] = [];
  const config = loadLanguageToolsConfig(getAgentDir(), (message) =>
    diagnostics.push(message),
  );
  pi.registerTool(createLangTool({ loadConfig: () => config }));

  let reported = false;
  pi.on("session_start", (_event, ctx) => {
    void disposeAllLspClients().catch(() => undefined);
    if (!reported && diagnostics.length > 0) {
      reported = true;
      for (const message of diagnostics) {
        ctx.ui.notify(`pi-language-tools: ${message}`, "warning");
      }
    }
    const active = pi.getActiveTools();
    const next = active.filter((name) => name !== "lang");
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

  pi.on("session_shutdown", () => {
    void disposeAllLspClients().catch(() => undefined);
  });
}
