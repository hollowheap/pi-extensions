import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { disposeAllLspClients } from "./lsp.js";
import { codeIntelTool } from "./tool.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(codeIntelTool);

  pi.on("session_start", () => {
    void disposeAllLspClients();
    if (!pi.getAllTools().some((tool) => tool.name === "codemode")) return;
    const active = pi.getActiveTools();
    if (active.includes("codemode")) return;
    pi.setActiveTools([...active, "codemode"]);
  });

  pi.on("session_shutdown", () => {
    void disposeAllLspClients();
  });
}
