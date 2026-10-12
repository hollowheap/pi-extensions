import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type Effect, type Rule, type Verb, check } from "./rules.js";

// Bash is not checked here: bash can still write outside allowed paths until bash rules exist.
const TOOL_VERBS: Record<string, Verb> = {
	write: "write",
	find: "read",
	grep: "read",
	fd: "read",
	rg: "read",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildRule(
	effect: unknown,
	verb: unknown,
	pattern: unknown,
	diagnostics: string[],
): Rule | undefined {
	if (
		(effect === "allow" || effect === "deny") &&
		(verb === "read" || verb === "write") &&
		typeof pattern === "string" &&
		pattern !== ""
	) {
		return { effect, verb, pattern };
	}
	diagnostics.push('ignoring rule: need "allow|deny read|write <pattern>"');
	return undefined;
}

function parseRuleEntry(
	entry: unknown,
	diagnostics: string[],
): Rule | undefined {
	if (typeof entry === "string") {
		const [effect, verb, ...rest] = entry.trim().split(/\s+/);
		return buildRule(effect, verb, rest.join(" "), diagnostics);
	}
	if (isRecord(entry)) {
		return buildRule(entry.effect, entry.verb, entry.pattern, diagnostics);
	}
	diagnostics.push("ignoring rule: must be an object or a string");
	return undefined;
}

function parseRulesFile(content: string, diagnostics: string[]): Rule[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		diagnostics.push("permissions file is not valid JSON");
		return [];
	}
	const entries =
		isRecord(parsed) && Array.isArray(parsed.rules)
			? parsed.rules
			: Array.isArray(parsed)
				? parsed
				: undefined;
	if (entries === undefined) {
		diagnostics.push('permissions file must be {"rules": [...]} or [...]');
		return [];
	}
	const rules: Rule[] = [];
	for (const entry of entries) {
		const rule = parseRuleEntry(entry, diagnostics);
		if (rule !== undefined) rules.push(rule);
	}
	return rules;
}

let cachedCwd: string | undefined;
let cachedMtimeMs = -1;
let cachedRules: Rule[] | undefined;
let warnedCwd: string | undefined;

function loadRules(ctx: ExtensionContext): Rule[] | undefined {
	const path = join(ctx.cwd, ".pi", "permissions.json");
	let mtimeMs = -1;
	try {
		mtimeMs = statSync(path).mtimeMs;
	} catch {
		mtimeMs = -1;
	}
	if (cachedCwd === ctx.cwd && cachedMtimeMs === mtimeMs) {
		return cachedRules;
	}
	cachedCwd = ctx.cwd;
	cachedMtimeMs = mtimeMs;
	if (mtimeMs < 0) {
		cachedRules = undefined;
		if (warnedCwd !== ctx.cwd) {
			warnedCwd = ctx.cwd;
			ctx.ui.notify(
				"pi-permissions: no .pi/permissions.json; allowing all tool paths",
				"warning",
			);
		}
		return cachedRules;
	}
	const diagnostics: string[] = [];
	try {
		cachedRules = parseRulesFile(readFileSync(path, "utf8"), diagnostics);
	} catch {
		diagnostics.push("cannot read permissions file; allowing all tool paths");
		cachedRules = undefined;
	}
	if (diagnostics.length > 0) {
		ctx.ui.notify(
			`pi-permissions: ${diagnostics.slice(0, 3).join("; ")}; allowing unmatched paths`,
			"warning",
		);
	}
	return cachedRules;
}

function readPathArg(input: unknown): string | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const path = (input as Record<string, unknown>).path;
	return typeof path === "string" && path !== "" ? path : undefined;
}

export default function (pi: ExtensionAPI) {
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
