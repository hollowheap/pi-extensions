import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMode } from "@hollowheap/core/modes";
import type { ModeLayer } from "@hollowheap/core/types";

export const AUTOPILOT_MODE: ModeLayer = Object.freeze({
  name: "autopilot",
  description: "Writes and non-dangerous bash run without asking",
  defaults: Object.freeze({
    read: "allow",
    search: "allow",
    edit: "allow",
    shell: "allow",
    external: "allow",
  }),
  onEnter: () => ({
    notice: {
      text: "autopilot on: writes and non-dangerous bash run without asking",
      level: "warning" as const,
    },
  }),
});

export default function (_pi: ExtensionAPI): void {
  registerMode(AUTOPILOT_MODE);
}
