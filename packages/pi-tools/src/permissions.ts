import {
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { type Rule, loadPermissions } from "@hollowheap/core";

export function loadContextPermissions(ctx: ExtensionContext): Rule[] {
  return loadPermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) => ctx.ui.notify(`pi-tools: ${message}`, "warning"),
  });
}
