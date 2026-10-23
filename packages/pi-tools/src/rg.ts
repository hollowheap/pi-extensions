import { statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { checkPath, displayPath, effectiveCwd } from "@hollowheap/core";
import { type ExecDeps, clampMaxResults, defaultExecDeps } from "./exec.js";
import { loadContextPermissions } from "./permissions.js";

const RG_LINE = /^(.*):(\d+):(.*)$/;

export interface RgMatch {
  path: string;
  line: number;
  text: string;
}

export function isFileTarget(path: string): boolean {
  try {
    return !statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function parseRgLine(line: string): RgMatch | undefined {
  const match = RG_LINE.exec(line);
  if (!match) return undefined;
  return { path: match[1], line: Number(match[2]), text: match[3] };
}

export function createRgTool(deps: ExecDeps = defaultExecDeps) {
  return defineTool({
    name: "rg",
    label: "rg",
    description:
      "Search file contents with a regular expression. Returns file path, line number, and matching line.",
    exposure: "codemode",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regular expression to search for" }),
      path: Type.Optional(
        Type.String({
          description:
            "Directory or file to search; defaults to the working directory",
        }),
      ),
      glob: Type.Optional(
        Type.String({ description: 'File filter such as "*.ts"' }),
      ),
      max_results: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 500,
          default: 100,
          description: "Maximum matches to return",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const root = ctx.cwd;
      const effective = effectiveCwd(ctx.cwd, ctx.sessionManager);
      const target = resolve(effective, params.path ?? ".");
      const targetIsFile = isFileTarget(target);
      const searchDir = targetIsFile ? dirname(target) : target;
      const operand = targetIsFile ? basename(target) : ".";
      const args = [
        "--color=never",
        "--no-heading",
        "--with-filename",
        "--line-number",
        "--no-config",
        "--regexp",
        params.pattern,
      ];
      if (params.glob !== undefined) args.push("--glob", params.glob);
      args.push("--", operand);
      const stdout = await deps.run("rg", args, searchDir, signal, {
        okExitCodes: [1],
      });
      const rules = loadContextPermissions(ctx);
      const limit = clampMaxResults(params.max_results);
      const matches: RgMatch[] = [];
      for (const raw of stdout.split("\n")) {
        if (raw === "") continue;
        const parsed = parseRgLine(raw);
        if (parsed === undefined) continue;
        const abs = resolve(searchDir, parsed.path);
        const display = displayPath(effective, abs);
        if (checkPath(rules, abs, "search", root) === "deny") continue;
        matches.push({ path: display, line: parsed.line, text: parsed.text });
        if (matches.length >= limit) break;
      }
      const lines = matches.map((match) =>
        `${match.path}:${match.line}:${match.text}`.slice(0, 300),
      );
      return {
        content: [
          {
            type: "text",
            text: lines.length > 0 ? lines.join("\n") : "No matches found.",
          },
        ],
        details: { pattern: params.pattern, root, matches },
      };
    },
  });
}

export const rgTool = createRgTool();
