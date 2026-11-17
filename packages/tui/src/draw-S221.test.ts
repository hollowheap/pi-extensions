import { afterEach, describe, expect, it, vi } from "vitest";
import { resetActiveTuiConfig } from "./state.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    highlightCode: vi.fn((_code: string, lang?: string) => [
      `HL-${lang ?? "plain"}`,
    ]),
  };
});

import { showMarkdownPager } from "./pager.js";

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

describe("S221 pager code fence highlighting", () => {
  it("highlights a supported fenced language through the host highlighter", async () => {
    const env = pagerContext();
    await showMarkdownPager(env.ctx as never, {
      title: "Report",
      markdown: "```ts\nconst x = 1;\n```",
    });

    const rendered = env.component()?.render(80).join("\n") ?? "";
    expect(rendered).toContain("HL-ts");
  });
});
