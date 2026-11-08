import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadLanguageToolsConfig } from "./config.js";
import { createLangTool, isLspLoaded, setLspLoaded } from "./tool.js";

export default function (pi: ExtensionAPI) {
  const diagnostics: string[] = [];
  const config = loadLanguageToolsConfig(getAgentDir(), (message) =>
    diagnostics.push(message),
  );
  pi.registerTool(createLangTool({ loadConfig: () => config }));

  const disposeIfLoaded = async () => {
    if (!isLspLoaded()) return;
    try {
      const { disposeAllLspClients } = await import("./lsp.js");
      await disposeAllLspClients();
    } catch {
      // ignore
    } finally {
      setLspLoaded(false);
    }
  };

  let reported = false;
  pi.on("session_start", (_event, ctx) => {
    void disposeIfLoaded();
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
    void disposeIfLoaded();
  });
}
