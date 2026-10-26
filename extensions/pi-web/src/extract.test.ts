import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  extractHtml,
  extractLinks,
  extractMedia,
  extractTitle,
  htmlToMarkdown,
  resolveUrl,
} from "./extract.js";

describe("HTML extraction", () => {
  it("decodes entities and resolves safe URLs", () => {
    expect(decodeEntities("A &amp; B &#39;ok&#39;")).toBe("A & B 'ok'");
    expect(resolveUrl("/next", "https://example.com/docs/")).toBe(
      "https://example.com/next",
    );
    expect(resolveUrl("javascript:alert(1)")).toBe("");
    expect(resolveUrl("data:text/html,x")).toBe("");
  });

  it("extracts the page title", () => {
    expect(
      extractTitle("<html><head><title> Docs &amp; API </title></head></html>"),
    ).toBe("Docs & API");
    expect(
      extractTitle('<meta property="og:title" content="Open Graph">'),
    ).toBe("Open Graph");
    expect(extractTitle("<h1>Fallback</h1>")).toBe("Fallback");
  });

  it("converts common HTML to readable Markdown", () => {
    const html = `
      <html><head><title>T</title><script>bad()</script></head>
      <body>
        <h1>Title</h1>
        <p>Hello <a href="/docs">docs</a>.</p>
        <pre><code>const x = 1;</code></pre>
        <ul><li>One</li><li>Two</li></ul>
        <img src="/img.png" alt="Pic">
      </body></html>`;
    const markdown = htmlToMarkdown(html, "https://example.com/base/");
    expect(markdown).toContain("# Title");
    expect(markdown).toContain("[docs](https://example.com/docs)");
    expect(markdown).toContain("```\nconst x = 1;\n```");
    expect(markdown).toContain("- One");
    expect(markdown).toContain("![Pic](https://example.com/img.png)");
    expect(markdown).not.toContain("bad()");
  });

  it("extracts unique links and media metadata", () => {
    const html = `
      <a href="/one">One</a>
      <a href="/one">Again</a>
      <a href="javascript:void(0)">Skip</a>
      <img src="/pic.png" alt="Pic">
      <video src="/clip.mp4"></video>
      <audio src="/sound.mp3"></audio>
      <source src="/movie.webm" type="video/webm">
      <img src="data:image/png;base64,x" alt="Inline">
    `;
    const links = extractLinks(html, "https://example.com/docs/");
    expect(links).toEqual([{ url: "https://example.com/one", text: "One" }]);

    const media = extractMedia(html, "https://example.com/docs/");
    expect(media).toEqual([
      {
        url: "https://example.com/pic.png",
        kind: "image",
        alt: "Pic",
        mimeType: "image/png",
      },
      {
        url: "https://example.com/clip.mp4",
        kind: "video",
        mimeType: "video/mp4",
      },
      {
        url: "https://example.com/sound.mp3",
        kind: "audio",
        mimeType: "audio/mpeg",
      },
      {
        url: "https://example.com/movie.webm",
        kind: "video",
        mimeType: "video/webm",
      },
    ]);
  });

  it("returns title, content, links, and media together", () => {
    const page = extractHtml(
      "<title>Page</title><p>Hello</p><a href='/x'>X</a><img src='/i.png'>",
      "https://example.com/docs/",
    );
    expect(page.title).toBe("Page");
    expect(page.content).toContain("Hello");
    expect(page.links[0]?.url).toBe("https://example.com/x");
    expect(page.media[0]?.url).toBe("https://example.com/i.png");
  });
});
