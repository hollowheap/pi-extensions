import { rawFetch } from "../../extensions/pi-web/src/fetch.ts";
import { withProviderFallback } from "../../extensions/pi-web/src/providers/selection.ts";

const emptyFirst = await withProviderFallback(
  ["empty", "filled"] as const,
  async (provider) => (provider === "empty" ? [] : ["hit"]),
);
console.log("SEARCH_FALLBACK_RESULT=", JSON.stringify(emptyFirst));

let bodyCanceled = false;
const fakeResponse = {
  status: 404,
  statusText: "Not Found",
  ok: false,
  url: "https://example.com/",
  headers: new Headers({ "content-type": "text/html" }),
  body: {
    cancel: async () => {
      bodyCanceled = true;
    },
  },
};
try {
  await rawFetch("https://example.com/", {
    fetchImpl: (async () => fakeResponse) as unknown as typeof fetch,
  });
} catch {
  // expected
}
console.log("NON_OK_BODY_CANCELED=", bodyCanceled);
