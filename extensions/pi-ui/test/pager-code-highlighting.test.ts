import {
  getActiveTuiConfig,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/ui/state";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    highlightCode: vi.fn((_code: string, lang?: string) => [
      `HL-${lang ?? "plain"}`,
    ]),
  };
});

import { showMarkdownPager } from "../src/pager.js";

const theme = {
  fg: (_token: string, text: string) => text,
  bg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  strikethrough: (text: string) => text,
};

function pagerContext() {
  let component:
    | { render(width: number): string[]; handleInput(data: string): void }
    | undefined;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify: vi.fn(),
      custom: vi.fn(
        async (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: () => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) => {
          component = factory(
            { terminal: { rows: 12 }, requestRender: vi.fn() },
            theme,
            {},
            vi.fn(),
          );
        },
      ),
    },
  };
  return { ctx, component: () => component };
}

afterEach(() => {
  resetActiveTuiConfig();
});

describe("pager code fence highlighting", () => {
  it("highlights a supported fenced language through the host highlighter", async () => {
    const env = pagerContext();
    await showMarkdownPager(env.ctx as never, {
      title: "Report",
      markdown: "```ts\nconst x = 1;\n```",
    });

    const rendered = env.component()?.render(80).join("\n") ?? "";
    expect(rendered).toContain("HL-ts");
  });

  it("a fence without a language uses the plain highlighter token", async () => {
    const env = pagerContext();
    await showMarkdownPager(env.ctx as never, {
      title: "Report",
      markdown: "```\nplain text\n```",
    });

    const rendered = env.component()?.render(80).join("\n") ?? "";
    expect(rendered).toContain("HL-");
    expect(rendered).not.toContain("HL-ts");
  });

  it("uncolored config bypasses host highlighting", async () => {
    setActiveTuiConfig({ ...getActiveTuiConfig(), colored: false });
    const env = pagerContext();
    await showMarkdownPager(env.ctx as never, {
      title: "Report",
      markdown: "```ts\nconst x = 1;\n```",
    });

    const rendered = env.component()?.render(80).join("\n") ?? "";
    expect(rendered).toContain("const x = 1;");
    expect(rendered).not.toContain("HL-ts");
  });

  it("blockquotes and lists keep their styled borders and bullets", async () => {
    const tokenTheme = {
      fg: (token: string, text: string) => `<${token}>${text}</${token}>`,
      bold: (text: string) => `<bold>${text}</bold>`,
      italic: (text: string) => `<italic>${text}</italic>`,
      underline: (text: string) => `<underline>${text}</underline>`,
      strikethrough: (text: string) => `<strike>${text}</strike>`,
    };
    const env = pagerContext();
    (env.ctx.ui as { theme?: unknown }).theme = tokenTheme;
    await showMarkdownPager(env.ctx as never, {
      title: "Report",
      markdown: "> quoted line\n\n- bullet item",
    });

    const rendered = env.component()?.render(80).join("\n") ?? "";
    expect(rendered).toContain("<muted><italic>quoted line</italic></muted>");
    expect(rendered).toContain("<accent>- </accent>");
  });
});
