import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  extractHtml,
  extractTitle,
  htmlToMarkdown,
  resolveUrl,
  stripTags,
} from "../src/extract.js";

describe("raw static HTML is extracted to readable Markdown", () => {
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

  it("decodes entities and strips tags from raw text", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&apos;&nbsp;&#65;&#x42;")).toBe(
      "&<>\"' AB",
    );
    expect(stripTags("<p>hello <b>world</b></p>")).toContain("hello");
    expect(extractTitle("<title>A &amp; B</title>")).toBe("A & B");
  });

  it("resolves relative links and drops unsafe schemes", () => {
    expect(resolveUrl("/a", "https://example.com/dir/")).toBe(
      "https://example.com/a",
    );
    expect(resolveUrl("../b", "https://example.com/dir/page")).toBe(
      "https://example.com/b",
    );
    expect(resolveUrl("//cdn.example.com/x", "https://example.com/")).toBe(
      "https://cdn.example.com/x",
    );
    expect(resolveUrl("data:text/html,x")).toBe("");
    expect(resolveUrl("javascript:alert(1)")).toBe("");
  });

  it("extracts readable content from plain text without markup", () => {
    const page = extractHtml("plain text only", "https://example.com/");
    expect(page.title).toBe("");
    expect(page.content).toContain("plain text only");
    expect(page.links).toEqual([]);
    expect(htmlToMarkdown("plain text only")).toContain("plain text only");
  });
});
