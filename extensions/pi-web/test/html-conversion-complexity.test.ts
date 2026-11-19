import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/extract.js";

describe("linear-time HTML conversion", () => {
  it("converts hostile unclosed markup quickly and without throwing", () => {
    const hostile = `<${"a".repeat(200_000)}`;
    const start = performance.now();
    const output = htmlToMarkdown(hostile);
    const duration = performance.now() - start;

    expect(output).toBe(hostile);
    expect(duration).toBeLessThan(1_000);
  });

  it("well-formed headings and anchors convert to markdown", () => {
    const output = htmlToMarkdown(
      '<h1>Title</h1><p>Hello <a href="https://example.com">link</a></p>',
    );

    expect(output).toContain("# Title");
    expect(output).toContain("[link](https://example.com)");
  });

  it("script and style bodies are removed from the output", () => {
    const output = htmlToMarkdown(
      "<style>.secret{color:red}</style><p>visible</p><script>alert(1)</script>",
    );

    expect(output).toBe("visible");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("alert");
  });

  it("numeric and named entities are decoded into text", () => {
    const output = htmlToMarkdown("Tom &amp; Jerry &#x1F600; &lt;done&gt;");

    expect(output).toBe("Tom & Jerry 😀 <done>");
  });
});
