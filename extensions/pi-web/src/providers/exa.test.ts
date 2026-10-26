import { describe, expect, it, vi } from "vitest";
import { EXA_CONTENTS_URL, EXA_SEARCH_URL, ExaAdapter } from "./exa.js";
import type { NormalizedFetchResult } from "./types.js";

describe("ExaAdapter", () => {
  it("parses search results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "T",
            url: "https://example.com",
            text: "snippet",
            highlights: ["h"],
          },
        ],
      }),
    });
    const adapter = new ExaAdapter({ fetchImpl: fetchMock as never });
    const results = await adapter.search({ query: "q", apiKey: "k" });
    expect(results[0].snippet).toBe("snippet");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EXA_SEARCH_URL);
    expect(init.headers).toMatchObject({ "x-api-key": "k" });
    expect(JSON.parse(init.body as string)).toEqual({
      query: "q",
      numResults: 5,
      contents: { text: true },
    });
  });

  it("handles missing fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{}] }),
    });
    const adapter = new ExaAdapter({ fetchImpl: fetchMock as never });
    const results = await adapter.search({ query: "q" });
    expect(results[0]).toMatchObject({
      title: "",
      url: "",
      snippet: "",
      provider: "exa",
    });
  });

  it("throws on HTTP error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, statusText: "Err" });
    const adapter = new ExaAdapter({ fetchImpl: fetchMock as never });
    await expect(adapter.search({ query: "q" })).rejects.toThrow();
  });

  it("parses fetch/contents", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ url: "https://example.com", text: "content" }],
      }),
    });
    const adapter = new ExaAdapter({ fetchImpl: fetchMock as never });
    const result = (await adapter.fetch?.({
      url: "https://example.com",
      apiKey: "k",
    })) as NormalizedFetchResult;
    expect(result.content).toBe("content");
    expect(result.provider).toBe("exa");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EXA_CONTENTS_URL);
    expect(init.headers).toMatchObject({ "x-api-key": "k" });
    expect(JSON.parse(init.body as string)).toEqual({
      urls: ["https://example.com"],
      text: true,
    });
    expect(JSON.parse(init.body as string)).not.toHaveProperty("ids");
  });
});
