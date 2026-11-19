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

interface CharTotals {
  thinking: number;
  agentOutput: number;
  userInput: number;
  toolOutput: number;
  toolInput: number;
  systemPrompt: number;
  skills: number;
}

function accumulateAssistantContent(
  content: unknown,
  totals: CharTotals,
): void {
  if (typeof content === "string") {
    totals.agentOutput += content.length;
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (part === null || typeof part !== "object") continue;
    const block = part as {
      type?: unknown;
      text?: unknown;
      thinking?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    if (block.type === "thinking" && typeof block.thinking === "string") {
      totals.thinking += block.thinking.length;
    } else if (block.type === "text" && typeof block.text === "string") {
      totals.agentOutput += block.text.length;
    } else if (block.type === "toolCall") {
      const nameLen = typeof block.name === "string" ? block.name.length : 0;
      const argsLen =
        typeof block.arguments === "string"
          ? block.arguments.length
          : JSON.stringify(block.arguments ?? {}).length;
      totals.toolInput += nameLen + argsLen;
    }
  }
}

function accumulateSystemMessage(
  msg: { content?: unknown; sections?: Record<string, string> },
  totals: CharTotals,
): void {
  if (msg.sections && typeof msg.sections === "object") {
    for (const [key, val] of Object.entries(msg.sections)) {
      if (typeof val !== "string") continue;
      if (key.toLowerCase().includes("skill")) {
        totals.skills += val.length;
      } else {
        totals.systemPrompt += val.length;
      }
    }
  }
  if (typeof msg.content === "string") {
    totals.systemPrompt += msg.content.length;
  }
}

function accumulateMessageEntry(entry: unknown, totals: CharTotals): void {
  if (entry === null || typeof entry !== "object") return;
  const typed = entry as { type?: unknown; message?: unknown };
  if (typed.type !== "message" && !typed.message) return;

  const msg = (typed.message ?? typed) as {
    role?: unknown;
    content?: unknown;
    sections?: Record<string, string>;
  };
  const role = String(msg.role ?? "");

  if (role === "user") {
    totals.userInput += stringifyContent(msg.content).length;
  } else if (role === "assistant") {
    accumulateAssistantContent(msg.content, totals);
  } else if (role === "toolResult" || role === "tool") {
    totals.toolOutput += stringifyContent(msg.content).length;
  } else if (role === "system") {
    accumulateSystemMessage(msg, totals);
  }
}

export function calculateContextBreakdown(
  entries: readonly unknown[],
  options: ContextBreakdownOptions = {},
): ContextBreakdown {
  const totals: CharTotals = {
    thinking: 0,
    agentOutput: 0,
    userInput: 0,
    toolOutput: 0,
    toolInput: 0,
    systemPrompt: options.systemPrompt?.length ?? 0,
    skills: options.skillsPrompt?.length ?? 0,
  };

  for (const entry of entries) {
    accumulateMessageEntry(entry, totals);
  }

  const thinking = charsToTokens(totals.thinking);
  const agentOutput = charsToTokens(totals.agentOutput);
  const userInput = charsToTokens(totals.userInput);
  const toolOutput = charsToTokens(totals.toolOutput);
  const toolInput = charsToTokens(totals.toolInput);
  const systemPrompt = charsToTokens(totals.systemPrompt);
  const skills = charsToTokens(totals.skills);
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
