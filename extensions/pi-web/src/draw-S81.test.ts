import { describe, expect, it } from "vitest";
import { extractHtml, htmlToMarkdown } from "./extract.js";

describe("S81: raw static HTML is extracted to readable Markdown", () => {
  it("returns title, Markdown content, links, and media without a browser", () => {
    const page = extractHtml(
      "<title>Page</title><h1>Heading</h1><p>Hello <b>world</b></p><a href='/x'>X</a><img src='/i.png'>",
      "https://example.com/docs/",
    );
    expect(page.title).toBe("Page");
    expect(htmlToMarkdown("<h1>Heading</h1>")).toContain("Heading");
    expect(page.content).toContain("Hello");
    expect(page.links[0]?.url).toBe("https://example.com/x");
    expect(page.media[0]?.url).toBe("https://example.com/i.png");
  });
});
