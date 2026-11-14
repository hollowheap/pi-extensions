// Feasibility probe for keyless web search via DuckDuckGo HTML endpoint
async function probeDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Body length: ${text.length}`);
    const hasResults =
      text.includes("result__title") || text.includes("result__snippet");
    console.log(`Has search result markers: ${hasResults}`);
  } catch (err) {
    console.error(`Fetch failed: ${err.message}`);
  }
}

probeDuckDuckGo("pi coding agent");
