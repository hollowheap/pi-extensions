import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ModeDefinition, ModesQuery } from "@hollowheap/core";

export const GUARD_MODES_CHANNEL = "guard:modes";

const AUTOPILOT_MODE: ModeDefinition = {
  name: "autopilot",
  apply: (_tag, verdict) => (verdict === "deny" ? "deny" : "allow"),
  onEnter: () => ({
    notice: {
      text: "autopilot on: writes and non-dangerous bash run without asking",
      level: "warning",
    },
  }),
};

export default function (pi: ExtensionAPI): void {
  pi.events.on(GUARD_MODES_CHANNEL, (data) => {
    const query = data as ModesQuery;
    if (query.modes.some((entry) => entry.name === AUTOPILOT_MODE.name)) return;
    query.modes.push(AUTOPILOT_MODE);
  });
}
