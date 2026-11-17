import {
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { loadPermissions, loadToolTags } from "@hollowheap/core/config";
import { type PathTag, checkPath } from "@hollowheap/core/policy";
import type { Rule, Tag } from "@hollowheap/core/types";

const PATH_TAGS: readonly PathTag[] = ["edit", "read", "search"];

function isPathTag(tag: Tag): tag is PathTag {
  return PATH_TAGS.includes(tag as PathTag);
}

function contextOptions(ctx: ExtensionContext) {
  return {
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message: string) =>
      ctx.ui.notify(`pi-tools: ${message}`, "warning"),
  };
}

export function loadContextPolicy(ctx: ExtensionContext): {
  rules: Rule[];
  toolTags: Readonly<Record<string, Tag>>;
} {
  const options = contextOptions(ctx);
  return {
    rules: loadPermissions(options),
    toolTags: loadToolTags(options),
  };
}

export function loadContextPermissions(ctx: ExtensionContext): Rule[] {
  return loadContextPolicy(ctx).rules;
}

export function isPathDenied(
  ctx: ExtensionContext,
  path: string,
  root: string,
): boolean {
  const { rules, toolTags } = loadContextPolicy(ctx);
  const tags = new Set<PathTag>([
    ...PATH_TAGS,
    ...Object.values(toolTags).filter(isPathTag),
  ]);
  for (const tag of tags) {
    if (checkPath(rules, path, tag, root) === "deny") return true;
  }
  return false;
}
