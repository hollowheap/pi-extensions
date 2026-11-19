import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { notify } from "@hollowheap/pi-ui/host";
import { loadLanguageToolsConfig } from "./settings.js";
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
    // Clients are disposed on session start, so the LSP snapshot restarts empty.
    updateSessionSnapshot(ctx.sessionManager, "lsp", undefined);
    if (!reported && diagnostics.length > 0) {
      reported = true;
      for (const message of diagnostics) {
        notify(ctx, `pi-language-tools: ${message}`, "warning");
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

  pi.on("session_shutdown", () => disposeIfLoaded());

  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx?.hasUI) return;
    if (!event.systemPromptOptions) return;
    event.systemPromptOptions.sections =
      event.systemPromptOptions.sections ?? {};
    event.systemPromptOptions.sections.lang_format =
      "Code navigation uses the codemode-only `lang` tool (tools.lang). " +
      "Actions: definition, references, document_symbols, workspace_symbols, hover, " +
      "signature_help, type_definition, implementation, document_highlights, diagnostics. " +
      "line and column are 1-based. Requires a trusted project and an installed language server.";
  });
}
