import {
  assertSafeUrl,
  isUnsafeHost,
} from "../../extensions/pi-web/src/url.ts";

const urls = [
  "http://127.0.0.1/",
  "http://[::1]/",
  "http://[0:0:0:0:0:0:0:1]/",
  "http://localtest.me/",
  "http://127.0.0.1.nip.io/",
];

for (const url of urls) {
  try {
    assertSafeUrl(url);
    console.log(
      "ALLOWED",
      url,
      "hostSafe=",
      isUnsafeHost(new URL(url).hostname),
    );
  } catch (error) {
    console.log(
      "BLOCKED",
      url,
      "-",
      error instanceof Error ? error.message : String(error),
    );
  }
}
