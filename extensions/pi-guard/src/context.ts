export interface ContextBreakdown {
  thinking: number;
  agentOutput: number;
  userInput: number;
  toolOutput: number;
  toolInput: number;
  systemPrompt: number;
  skills: number;
  total: number;
  limit?: number;
}

export interface ContextBreakdownOptions {
  limit?: number;
  systemPrompt?: string;
  skillsPrompt?: string;
}

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let result = "";
  for (const part of content) {
    if (typeof part === "string") {
      result += part;
    } else if (part !== null && typeof part === "object") {
      const block = part as { text?: unknown; content?: unknown };
      if (typeof block.text === "string") {
        result += block.text;
      } else if (typeof block.content === "string") {
        result += block.content;
      }
    }
  }
  return result;
}

export function calculateContextBreakdown(
  entries: readonly unknown[],
  options: ContextBreakdownOptions = {},
): ContextBreakdown {
  let thinkingChars = 0;
  let agentOutputChars = 0;
  let userInputChars = 0;
  let toolOutputChars = 0;
  let toolInputChars = 0;
  let systemPromptChars = options.systemPrompt?.length ?? 0;
  let skillsChars = options.skillsPrompt?.length ?? 0;

  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const typed = entry as { type?: unknown; message?: unknown };

    if (typed.type === "message" || typed.message) {
      const msg = (typed.message ?? typed) as {
        role?: unknown;
        content?: unknown;
      };
      const role = String(msg.role ?? "");

      if (role === "user") {
        userInputChars += stringifyContent(msg.content).length;
      } else if (role === "assistant") {
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part === null || typeof part !== "object") continue;
            const block = part as {
              type?: unknown;
              text?: unknown;
              thinking?: unknown;
              name?: unknown;
              arguments?: unknown;
            };
            if (
              block.type === "thinking" &&
              typeof block.thinking === "string"
            ) {
              thinkingChars += block.thinking.length;
            } else if (
              block.type === "text" &&
              typeof block.text === "string"
            ) {
              agentOutputChars += block.text.length;
            } else if (block.type === "toolCall") {
              const nameLen =
                typeof block.name === "string" ? block.name.length : 0;
              const argsLen =
                typeof block.arguments === "string"
                  ? block.arguments.length
                  : JSON.stringify(block.arguments ?? {}).length;
              toolInputChars += nameLen + argsLen;
            }
          }
        } else if (typeof msg.content === "string") {
          agentOutputChars += msg.content.length;
        }
      } else if (role === "toolResult" || role === "tool") {
        toolOutputChars += stringifyContent(msg.content).length;
      } else if (role === "system") {
        const sys = msg as {
          content?: unknown;
          sections?: Record<string, string>;
        };
        if (sys.sections && typeof sys.sections === "object") {
          for (const [key, val] of Object.entries(sys.sections)) {
            if (typeof val !== "string") continue;
            if (key.toLowerCase().includes("skill")) {
              skillsChars += val.length;
            } else {
              systemPromptChars += val.length;
            }
          }
        }
        if (typeof sys.content === "string") {
          systemPromptChars += sys.content.length;
        }
      }
    }
  }

  const thinking = charsToTokens(thinkingChars);
  const agentOutput = charsToTokens(agentOutputChars);
  const userInput = charsToTokens(userInputChars);
  const toolOutput = charsToTokens(toolOutputChars);
  const toolInput = charsToTokens(toolInputChars);
  const systemPrompt = charsToTokens(systemPromptChars);
  const skills = charsToTokens(skillsChars);
  const total =
    thinking +
    agentOutput +
    userInput +
    toolOutput +
    toolInput +
    systemPrompt +
    skills;

  return {
    thinking,
    agentOutput,
    userInput,
    toolOutput,
    toolInput,
    systemPrompt,
    skills,
    total,
    ...(options.limit !== undefined && options.limit > 0
      ? { limit: options.limit }
      : {}),
  };
}

function formatCount(num: number): string {
  return num.toLocaleString("en-US");
}

export function formatContextBreakdown(breakdown: ContextBreakdown): string {
  const header =
    breakdown.limit !== undefined
      ? `Context usage: ${formatCount(breakdown.total)} / ${formatCount(
          breakdown.limit,
        )} tokens (${((breakdown.total / breakdown.limit) * 100).toFixed(1)}%)`
      : `Context usage: ${formatCount(breakdown.total)} tokens (limit unknown)`;

  return [
    header,
    `- Agent thinking: ${formatCount(breakdown.thinking)} tokens`,
    `- Agent output: ${formatCount(breakdown.agentOutput)} tokens`,
    `- User input: ${formatCount(breakdown.userInput)} tokens`,
    `- Tool output: ${formatCount(breakdown.toolOutput)} tokens`,
    `- Tool input: ${formatCount(breakdown.toolInput)} tokens`,
    `- System prompt: ${formatCount(breakdown.systemPrompt)} tokens`,
    `- Skills: ${formatCount(breakdown.skills)} tokens`,
  ].join("\n");
}
