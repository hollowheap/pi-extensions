import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSubagentTool } from "./tool.js";

export default function (pi: ExtensionAPI): void {
  if (process.env.PI_ACP) return;
  pi.registerTool(createSubagentTool());
}
