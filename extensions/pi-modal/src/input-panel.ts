import { ExtensionInputComponent } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { boxFrame } from "@hollowheap/ui/frame";
import { panelRenderConfig } from "@hollowheap/ui/panel";
import { getActiveTuiConfig } from "@hollowheap/ui/state";

const PATCHED = Symbol.for("@hollowheap/pi-modal/extension-input-panel");

/** Frame host `ui.input` dialogs with the same panel config as our own UI. */
export function installExtensionInputPanel(
  getTheme: () => Theme | undefined,
): void {
  const prototype = ExtensionInputComponent.prototype as {
    render?: (width: number) => string[];
  };
  const installed = Reflect.get(prototype, PATCHED) as
    | { getTheme: typeof getTheme }
    | undefined;
  if (installed) {
    installed.getTheme = getTheme;
    return;
  }
  const original = prototype.render;
  if (typeof original !== "function") return;
  const patch = { getTheme };
  Reflect.set(prototype, PATCHED, patch);
  Reflect.set(
    prototype,
    "render",
    function (this: ExtensionInputComponent, width: number) {
      const lines = original.call(this, width);
      if (
        !panelRenderConfig(getActiveTuiConfig()).enabled ||
        lines.length < 3
      ) {
        return lines;
      }
      const theme = patch.getTheme();
      if (!theme) return lines;
      return boxFrame(lines.slice(1, -1), width, theme);
    },
  );
}
