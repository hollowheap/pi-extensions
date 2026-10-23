import {
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  type Rule,
  loadPermissions as loadCorePermissions,
} from "@hollowheap/core";

export function loadPermissions(ctx: ExtensionContext): Rule[] {
  return loadCorePermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) => ctx.ui.notify(`pi-acp: ${message}`, "warning"),
  });
}
