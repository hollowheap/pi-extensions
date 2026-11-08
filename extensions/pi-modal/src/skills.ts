import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

export interface SkillCommandLike {
  name: string;
  description?: string;
  source?: string;
  sourceInfo?: {
    path?: string;
    baseDir?: string;
  };
}

const SKILL_AUTOCOMPLETE_WRAPPED = Symbol(
  "pi-modal.skill-autocomplete-wrapped",
);
type WrappedMarker = { [SKILL_AUTOCOMPLETE_WRAPPED]?: boolean };
const wrappedProviders = new WeakSet<object>();
const registeredUIContexts = new WeakSet<object>();

export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    return match[1].trim();
  }
  return content.trim();
}

export function formatSkillBlock(
  name: string,
  filePath: string,
  baseDir: string,
  body: string,
): string {
  return `<skill name="${name}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
}

export function collapseWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripSkillTokens(text: string, skillNames: string[]): string {
  if (skillNames.length === 0) return collapseWhitespace(text);
  const sorted = [...new Set(skillNames)].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(escapeRegExp).join("|");
  const regex = new RegExp(
    `(?:^|(?<=\\s))\\$(?:${escaped})(?=$|\\s|[.,;:!?)\\]}])`,
    "g",
  );
  const stripped = text.replace(regex, "");
  return collapseWhitespace(stripped);
}

export function resolveSkillCommand(
  commands: SkillCommandLike[],
  skillName: string,
): SkillCommandLike | undefined {
  const target = skillName.toLowerCase();
  return commands.find((cmd) => {
    const isSkillSource = cmd.source === "skill";
    const hasSkillPrefix = cmd.name.toLowerCase().startsWith("skill:");
    if (!isSkillSource && !hasSkillPrefix) return false;
    const cmdSkillName = hasSkillPrefix ? cmd.name.slice(6) : cmd.name;
    return cmdSkillName.toLowerCase() === target;
  });
}

export function createSkillAutocompleteProvider(
  base: AutocompleteProvider,
  pi: ExtensionAPI,
): AutocompleteProvider {
  if (
    wrappedProviders.has(base) ||
    (base as WrappedMarker)[SKILL_AUTOCOMPLETE_WRAPPED] === true
  ) {
    return base;
  }

  const wrapper: AutocompleteProvider = {
    triggerCharacters: [...new Set([...(base.triggerCharacters ?? []), "$"])],

    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const before = currentLine.slice(0, cursorCol);
      const match = /(?:^|[\s])(\$[^\s]*)$/.exec(before);

      if (match) {
        const prefix = match[1];
        const query = prefix.slice(1).toLowerCase();

        const commands = (pi.getCommands?.() ?? []) as SkillCommandLike[];
        const seen = new Set<string>();
        const skills: Array<{ name: string; description?: string }> = [];

        for (const cmd of commands) {
          const isSkill =
            cmd.source === "skill" || cmd.name.startsWith("skill:");
          if (!isSkill) continue;
          const name = cmd.name.startsWith("skill:")
            ? cmd.name.slice(6)
            : cmd.name;
          if (!seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            skills.push({ name, description: cmd.description });
          }
        }

        const matches = skills.filter((s) =>
          s.name.toLowerCase().includes(query),
        );
        if (matches.length === 0) {
          return null;
        }

        matches.sort((a, b) => {
          const aLower = a.name.toLowerCase();
          const bLower = b.name.toLowerCase();
          const aStarts = aLower.startsWith(query);
          const bStarts = bLower.startsWith(query);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return a.name.localeCompare(b.name);
        });

        return {
          items: matches.map((s) => ({
            value: `$${s.name}`,
            label: `$${s.name}`,
            description: s.description,
          })),
          prefix,
        };
      }

      return base.getSuggestions(lines, cursorLine, cursorCol, options);
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (prefix.startsWith("$") || item.value.startsWith("$")) {
        const currentLine = lines[cursorLine] ?? "";
        const prefixStart = Math.max(0, cursorCol - prefix.length);
        const charAtCursor = currentLine[cursorCol];
        const hasTrailingWhitespace =
          charAtCursor !== undefined && /\s/.test(charAtCursor);
        const insertText = hasTrailingWhitespace
          ? item.value
          : `${item.value} `;
        const newLine =
          currentLine.slice(0, prefixStart) +
          insertText +
          currentLine.slice(cursorCol);
        const newLines = [...lines];
        newLines[cursorLine] = newLine;
        return {
          lines: newLines,
          cursorLine,
          cursorCol: prefixStart + insertText.length,
        };
      }
      return base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    ...(typeof base.shouldTriggerFileCompletion === "function"
      ? {
          shouldTriggerFileCompletion(
            lines: string[],
            cursorLine: number,
            cursorCol: number,
          ): boolean {
            return (
              base.shouldTriggerFileCompletion?.(
                lines,
                cursorLine,
                cursorCol,
              ) ?? true
            );
          },
        }
      : {}),
  };

  wrappedProviders.add(wrapper);
  Object.defineProperty(wrapper, SKILL_AUTOCOMPLETE_WRAPPED, {
    value: true,
    enumerable: false,
  });

  return wrapper;
}

export function registerSkillAutocomplete(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): void {
  if (registeredUIContexts.has(ctx.ui)) return;
  registeredUIContexts.add(ctx.ui);
  ctx.ui.addAutocompleteProvider?.((base) =>
    createSkillAutocompleteProvider(base, pi),
  );
}

export function handleSkillInput(
  event: InputEvent,
  pi: ExtensionAPI,
): InputEventResult | undefined {
  if (/^\s*[/!]/.test(event.text)) {
    return undefined;
  }

  const tokenMatches = event.text.matchAll(
    /(?:^|(?<=\s))\$([a-zA-Z0-9][a-zA-Z0-9._-]*)(?=$|\s|[.,;:!?)\]}])/g,
  );
  const tokens: string[] = [];
  for (const match of tokenMatches) {
    if (match[1]) {
      tokens.push(match[1]);
    }
  }

  if (tokens.length === 0) {
    return undefined;
  }

  const commands = (pi.getCommands?.() ?? []) as SkillCommandLike[];
  const resolvedSkills: Array<{
    name: string;
    filePath: string;
    baseDir: string;
    body: string;
  }> = [];
  const matchedTokens: string[] = [];
  const seenSkillNames = new Set<string>();

  for (const token of tokens) {
    const cmd = resolveSkillCommand(commands, token);
    if (!cmd) continue;
    const filePath = cmd.sourceInfo?.path;
    if (!filePath || typeof filePath !== "string") continue;

    const actualName = cmd.name.startsWith("skill:")
      ? cmd.name.slice(6)
      : cmd.name;
    if (!seenSkillNames.has(actualName.toLowerCase())) {
      seenSkillNames.add(actualName.toLowerCase());
      try {
        const raw = readFileSync(filePath, "utf-8");
        const body = stripFrontmatter(raw);
        const baseDir = cmd.sourceInfo?.baseDir ?? dirname(filePath);
        resolvedSkills.push({
          name: actualName,
          filePath,
          baseDir,
          body,
        });
      } catch {
        continue;
      }
    }
    matchedTokens.push(token);
  }

  if (resolvedSkills.length === 0) {
    return undefined;
  }

  const expandedBlocks = resolvedSkills.map((s) =>
    formatSkillBlock(s.name, s.filePath, s.baseDir, s.body),
  );

  const remainingText = stripSkillTokens(event.text, matchedTokens);
  const expandedText =
    remainingText.length > 0
      ? `${expandedBlocks.join("\n\n")}\n\n${remainingText}`
      : expandedBlocks.join("\n\n");

  return {
    action: "transform",
    text: expandedText,
    ...(event.images ? { images: event.images } : {}),
  };
}
