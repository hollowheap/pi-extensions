import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWebFetchTool, createWebSearchTool } from "./tools.js";

export default function (pi: ExtensionAPI): void {
  pi.registerTool(createWebSearchTool());
  pi.registerTool(createWebFetchTool());
}
