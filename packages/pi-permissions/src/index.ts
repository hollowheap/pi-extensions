import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fdTool } from "./fd.js";
import { loadRules } from "./loader.js";
import { rgTool } from "./rg.js";
import { type Effect, type Verb, check } from "./rules.js";

// Bash is not checked here: bash can still write outside allowed paths until bash rules exist.
const TOOL_VERBS: Record<string, Verb> = {
	write: "write",
	edit: "write",
	find: "read",
	grep: "read",
	fd: "read",
	rg: "read",
};

function readPathArg(input: unknown): string | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const path = (input as Record<string, unknown>).path;
	return typeof path === "string" && path !== "" ? path : undefined;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(fdTool);
	pi.registerTool(rgTool);
	pi.on("tool_call", (event, ctx) => {
		const verb: Verb | undefined = TOOL_VERBS[event.toolName];
		if (verb === undefined) return undefined;
		const rules = loadRules(ctx);
		if (rules === undefined) return undefined;
		const raw = readPathArg(event.input) ?? ".";
		const verdict: Effect = check(rules, raw, verb, ctx.cwd);
		if (verdict === "deny") {
			return {
				block: true,
				reason: `pi-permissions: ${verb} access to ${raw} is denied`,
			};
		}
		return undefined;
	});
}
