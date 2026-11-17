import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { formatDollarCost } from "@hollowheap/core/pricing";
import type { SessionSnapshot } from "@hollowheap/core/snapshot";
import { fitLines } from "./render.js";
import {
  type DashboardSessionItem,
  formatRelativeAge,
  sessionDisplayTitle,
} from "./sessions.js";

export interface StateRenderInput {
  cwd: string;
  model?: string;
  thinking?: string;
  snapshot: SessionSnapshot;
}

export interface SessionsRenderOptions {
  maxItems?: number;
  selectedIndex?: number;
  now?: number;
  showHint?: boolean;
}

export interface DashboardActionItem {
  key: string;
  label: string;
  command: string;
}

export const DEFAULT_DASHBOARD_ACTIONS: readonly DashboardActionItem[] = [
  { key: "t", label: "Todos", command: "/todos" },
  { key: "a", label: "Agent", command: "/agent" },
  { key: "u", label: "Usage", command: "/usage" },
  { key: "g", label: "Grants", command: "/grants" },
  { key: "s", label: "Settings", command: "/dashboard settings" },
];

function clean(text: string): string {
  return sanitizeTerminalText(text, { allowSgr: false })
    .replace(/\s+/g, " ")
    .trim();
}

export function formatCompactCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(Math.round(count));
}

function labeledRow(
  theme: Theme,
  label: string,
  parts: string[],
  separator = " · ",
): string {
  const prefix = theme.fg("dim", `${label.padEnd(8)} `);
  return `${prefix}${parts.join(theme.fg("dim", separator))}`;
}

export function renderStateSection(
  input: StateRenderInput,
  theme: Theme,
  width: number,
  align: "left" | "center" = "left",
): string[] {
  const snap = input.snapshot;
  const lines: string[] = [theme.bold(theme.fg("accent", "Session State"))];

  const effectiveCwd = snap.cwd?.effective || input.cwd;
  const projectLabel = clean(basename(effectiveCwd) || effectiveCwd);
  const identityParts: string[] = [
    theme.bold(projectLabel),
    theme.fg(
      snap.mode?.name ? "accent" : "dim",
      clean(snap.mode?.name ?? "default"),
    ),
  ];
  if (snap.agent?.name) {
    identityParts.push(theme.fg("success", `@${clean(snap.agent.name)}`));
  }
  if (snap.guard) {
    const trustText = snap.guard.trusted ? "trusted" : "restricted";
    const denySuffix =
      snap.guard.deniedCount > 0 ? ` (${snap.guard.deniedCount} denied)` : "";
    identityParts.push(
      theme.fg(
        snap.guard.trusted ? "success" : "warning",
        `${trustText}${denySuffix}`,
      ),
    );
  }
  lines.push(labeledRow(theme, "Project", identityParts));

  const modelText = clean(input.model || snap.agent?.model || "unselected");
  const thinking = clean(input.thinking || snap.agent?.thinking || "");
  const modelDisplay =
    thinking && thinking !== "off" ? `${modelText} (${thinking})` : modelText;
  const usageParts: string[] = [modelDisplay];
  if (snap.usage) {
    usageParts.push(`${formatCompactCount(snap.usage.totalTokens)} tok`);
    const costStr = formatDollarCost(snap.usage.totalCost);
    const budgetStr =
      snap.usage.budgetCap !== undefined
        ? `${costStr}/${formatDollarCost(snap.usage.budgetCap)}`
        : costStr;
    usageParts.push(
      snap.usage.budgetWarning
        ? theme.fg("warning", `${budgetStr}!`)
        : budgetStr,
    );
  }
  lines.push(labeledRow(theme, "Model", usageParts));

  const workParts: string[] = [];
  if (snap.todos && snap.todos.total > 0) {
    const high =
      snap.todos.highPriority > 0 ? ` (${snap.todos.highPriority} high)` : "";
    workParts.push(`todos ${snap.todos.open}/${snap.todos.total}${high}`);
  }
  if (snap.tasks && snap.tasks.total > 0) {
    workParts.push(`tasks ${snap.tasks.running}/${snap.tasks.total} run`);
  }
  if (snap.subagents && snap.subagents.total > 0) {
    workParts.push(
      `agents ${snap.subagents.running}/${snap.subagents.total} run`,
    );
  }
  if (workParts.length > 0) {
    lines.push(labeledRow(theme, "Work", workParts));
  }

  if (snap.todos && snap.todos.open > 0) {
    const openItems = snap.todos.items.filter((item) => !item.done).slice(0, 2);
    for (const item of openItems) {
      const pri = item.priority === "high" ? theme.fg("warning", "! ") : "";
      lines.push(
        `  ${theme.fg("dim", "□")} #${item.id} ${pri}${clean(item.text)}`,
      );
    }
  }

  const envParts: string[] = [];
  if (
    snap.memory &&
    (snap.memory.observations > 0 || snap.memory.reflections > 0)
  ) {
    envParts.push(
      `mem ${snap.memory.observations}obs/${snap.memory.reflections}ref`,
    );
  }
  if (snap.lsp && snap.lsp.servers.length > 0) {
    const names = snap.lsp.servers
      .slice(0, 2)
      .map((s) => clean(s.name))
      .join(",");
    const extra =
      snap.lsp.servers.length > 2 ? `+${snap.lsp.servers.length - 2}` : "";
    envParts.push(`lsp ${names}${extra}`);
  }
  if (snap.web && (snap.web.searchCount > 0 || snap.web.fetchCount > 0)) {
    envParts.push(`web ${snap.web.searchCount}s/${snap.web.fetchCount}f`);
  }
  if (snap.hooks && (snap.hooks.runs > 0 || snap.hooks.blocks > 0)) {
    const blocks = snap.hooks.blocks > 0 ? `/${snap.hooks.blocks}blk` : "";
    envParts.push(`hooks ${snap.hooks.runs}${blocks}`);
  }
  if (snap.questions && snap.questions.askedCount > 0) {
    envParts.push(`q ${snap.questions.askedCount}`);
  }
  if (snap.decide && snap.decide.totalCount > 0) {
    envParts.push(`decide ${snap.decide.totalCount}`);
  }
  if (envParts.length > 0) {
    lines.push(labeledRow(theme, "Context", envParts));
  }

  return fitLines(lines, width, align);
}

function formatSessionBadges(session: DashboardSessionItem): string[] {
  const badges: string[] = [`${session.messageCount}m`];
  const { summary } = session;
  if (summary.agent) badges.push(`@${clean(summary.agent)}`);
  if (summary.todosOpen !== undefined && summary.todosOpen > 0) {
    badges.push(`${summary.todosOpen} todo`);
  }
  if (summary.totalCost !== undefined && summary.totalCost > 0) {
    badges.push(formatDollarCost(summary.totalCost));
  }
  if (summary.observations !== undefined && summary.observations > 0) {
    badges.push(`${summary.observations} obs`);
  }
  if (summary.decideCalls !== undefined && summary.decideCalls > 0) {
    badges.push(`${summary.decideCalls} decide`);
  }
  return badges;
}

export function renderSessionsSection(
  sessions: readonly DashboardSessionItem[],
  theme: Theme,
  width: number,
  options: SessionsRenderOptions = {},
  align: "left" | "center" = "left",
): string[] {
  const maxItems = Math.max(1, options.maxItems ?? 5);
  const now = options.now ?? Date.now();
  const hint = options.showHint
    ? theme.fg("dim", "  (↑↓ select · Enter resume)")
    : "";
  const lines: string[] = [
    `${theme.bold(theme.fg("accent", "Recent Sessions"))}${hint}`,
  ];

  const slice = sessions.slice(0, maxItems);
  if (slice.length === 0) {
    lines.push(`  ${theme.fg("dim", "No previous sessions in this project")}`);
    return fitLines(lines, width, align);
  }

  for (let i = 0; i < slice.length; i += 1) {
    const item = slice[i];
    const selected = options.selectedIndex === i;
    const prefix = selected
      ? theme.fg("accent", "▶  ")
      : `${theme.fg("dim", `${i + 1}.`)} `;
    const age = formatRelativeAge(item.modified, now);
    const metaText = `[${age} · ${formatSessionBadges(item).join(" · ")}]`;
    const styledMeta = theme.fg("dim", metaText);
    const title = sessionDisplayTitle(item);
    const prefixW = visibleWidth(prefix);
    const metaW = visibleWidth(metaText) + 1;
    const titleBudget = Math.max(12, width - prefixW - metaW);
    const shortTitle = truncateToWidth(title, titleBudget);
    const styledTitle = selected ? theme.bold(shortTitle) : shortTitle;
    const gap = Math.max(
      1,
      width - prefixW - visibleWidth(shortTitle) - visibleWidth(metaText),
    );
    lines.push(`${prefix}${styledTitle}${" ".repeat(gap)}${styledMeta}`);
  }

  return fitLines(lines, width, align);
}

export function renderActionsSection(
  items: readonly DashboardActionItem[],
  theme: Theme,
  width: number,
  align: "left" | "center" = "left",
): string[] {
  const lines: string[] = [theme.bold(theme.fg("accent", "Quick Actions"))];
  const entries = items.map(
    (item) =>
      `${theme.fg("accent", `[${clean(item.key)}]`)} ${clean(item.command)}`,
  );

  let current = "";
  for (const entry of entries) {
    const next = current.length === 0 ? `  ${entry}` : `${current}   ${entry}`;
    if (visibleWidth(next) > width && current.length > 0) {
      lines.push(current);
      current = `  ${entry}`;
    } else {
      current = next;
    }
  }
  if (current.length > 0) lines.push(current);

  return fitLines(lines, width, align);
}
