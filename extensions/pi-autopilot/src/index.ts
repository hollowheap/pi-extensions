import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMode } from "@hollowheap/core/modes";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { session } from "@hollowheap/core/state";
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

function syncSnapshot(owner: unknown): void {
  if (owner === undefined || owner === null) return;
  const active = session(owner).mode === "autopilot";
  updateSessionSnapshot(owner, "autopilot", {
    active,
    updatedAt: Date.now(),
  });
}

export default function (pi: ExtensionAPI): void {
  registerMode(AUTOPILOT_MODE);
  if (typeof pi?.on === "function") {
    const sync = (_event: unknown, ctx?: { sessionManager?: unknown }) => {
      syncSnapshot(ctx?.sessionManager);
    };
    pi.on("session_start", sync);
    pi.on("session_tree", sync);
    pi.on("agent_start", sync);
    pi.on("turn_end", sync);
  }
}
