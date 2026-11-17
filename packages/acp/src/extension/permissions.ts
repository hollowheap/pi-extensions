import {
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { loadPermissions as loadCorePermissions } from "@hollowheap/core/config";
import type { EvaluateOptions } from "@hollowheap/core/modes";
import { loadGuardTrust } from "@hollowheap/core/trust";
import type { Rule } from "@hollowheap/core/types";

export function loadPermissions(ctx: ExtensionContext): Rule[] {
  return loadCorePermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) => ctx.ui.notify(`pi-acp: ${message}`, "warning"),
  });
}

export function loadEvaluateOptions(
  ctx: ExtensionContext,
): Pick<EvaluateOptions, "trustedRoots" | "persistentDecisions"> {
  const trust = loadGuardTrust(getAgentDir(), (message) =>
    ctx.ui.notify(`pi-acp: ${message}`, "warning"),
  );
  return {
    trustedRoots: trust.trustedRoots,
    persistentDecisions: trust.persistentDecisions,
  };
}
