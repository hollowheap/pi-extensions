import { relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { checkPath, displayPath, effectiveCwd } from "@hollowheap/core";
import { type ExecDeps, clampMaxResults, defaultExecDeps } from "./exec.js";
import { loadContextPermissions } from "./permissions.js";

export function createFdTool(deps: ExecDeps = defaultExecDeps) {
  return defineTool({
    name: "fd",
    label: "fd",
    description:
      "Find files by glob pattern. Returns paths relative to the working directory, newest first.",
    exposure: "codemode",
    parameters: Type.Object({
      pattern: Type.String({ description: 'Glob pattern, e.g. "*.ts"' }),
      path: Type.Optional(
        Type.String({
          description: "Directory to search; defaults to the working directory",
        }),
      ),
      max_results: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 500,
          default: 100,
          description: "Maximum paths to return",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const root = ctx.cwd;
      const effective = effectiveCwd(ctx.cwd, ctx.sessionManager);
      const searchDir = resolve(effective, params.path ?? ".");
      const dir = relative(effective, searchDir) || ".";
      const stdout = await deps.run(
        "fd",
        ["--glob", params.pattern, "--", dir],
        effective,
        signal,
      );
      const rules = loadContextPermissions(ctx);
      const found: { rel: string; mtime: number }[] = [];
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        const abs = resolve(effective, trimmed);
        const mtime = deps.statMtimeMs(abs);
        if (mtime === undefined) continue;
        const rel = displayPath(effective, abs);
        if (checkPath(rules, abs, "search", root) === "deny") continue;
        found.push({ rel, mtime });
      }
      found.sort((a, b) => b.mtime - a.mtime);
      const paths = found
        .slice(0, clampMaxResults(params.max_results))
        .map((entry) => entry.rel);
      return {
        content: [
          {
            type: "text",
            text: paths.length > 0 ? paths.join("\n") : "No files found.",
          },
        ],
        details: { pattern: params.pattern, root, paths },
      };
    },
  });
}

export const fdTool = createFdTool();
