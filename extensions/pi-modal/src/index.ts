import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ModalEditor } from "./editor.js";
import { loadModalConfig } from "./keymap.js";

export { ModalEditor } from "./editor.js";
export * from "./keymap.js";

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || typeof ctx.ui.setEditorComponent !== "function") return;
    const config = loadModalConfig(getAgentDir());
    if (config.enabled === false) return;
    ctx.ui.setEditorComponent(
      (tui, theme, kb) => new ModalEditor(tui, theme, kb, config),
    );
  });
}
