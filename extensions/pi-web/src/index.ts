import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";

export function createWebSearchTool() {
  return defineTool({
    name: "web_search",
    label: "web_search",
    description:
      "Search the web for current documentation and results. (Provider networking lands in a later task.)",
    exposure: "direct",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "Search query" }),
    }),
    async execute() {
      return {
        content: [{ type: "text", text: "web_search is not implemented yet." }],
        details: {},
      };
    },
  });
}

export function createWebFetchTool() {
  return defineTool({
    name: "web_fetch",
    label: "web_fetch",
    description:
      "Fetch a web page and return its contents. (Provider networking lands in a later task.)",
    exposure: "direct",
    parameters: Type.Object({
      url: Type.String({ minLength: 1, description: "URL to fetch" }),
    }),
    async execute() {
      return {
        content: [{ type: "text", text: "web_fetch is not implemented yet." }],
        details: {},
      };
    },
  });
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool(createWebSearchTool());
  pi.registerTool(createWebFetchTool());
}
