import type { NormalizedLink, NormalizedMedia } from "./providers/types.js";

export interface ExtractedPage {
  title: string;
  content: string;
  links: NormalizedLink[];
  media: NormalizedMedia[];
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

export function resolveUrl(href: string, base?: string): string {
  const trimmed = href.trim();
  const lower = trimmed.toLowerCase();
  if (
    trimmed === "" ||
    lower.startsWith("data:") ||
    lower.startsWith("javascript:")
  ) {
    return "";
  }
  try {
    return base === undefined ? trimmed : new URL(trimmed, base).href;
  } catch {
    return trimmed;
  }
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[2] ?? match?.[3] ?? match?.[4];
}

export function extractTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const value = decodeEntities(stripTags(title[1])).trim();
    if (value !== "") return value;
  }
  const og =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
    ) ??
    html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i,
    );
  if (og) return decodeEntities(og[1]).trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? decodeEntities(stripTags(h1[1])).trim() : "";
}

export function extractLinks(html: string, base?: string): NormalizedLink[] {
  const links: NormalizedLink[] = [];
  const seen = new Set<string>();
  const regex =
    /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const url = resolveUrl(match[2] ?? match[3] ?? match[4] ?? "", base);
    if (url === "" || seen.has(url)) continue;
    seen.add(url);
    const text = decodeEntities(stripTags(match[5])).trim();
    links.push(text === "" ? { url } : { url, text });
  }
  return links;
}

function mimeFromUrl(url: string): string | undefined {
  const path = new URL(url, "https://example.invalid").pathname;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    pdf: "application/pdf",
  };
  return mime[ext];
}

function mediaKind(
  url: string,
  mime: string | undefined,
  tag: string,
): NormalizedMedia["kind"] {
  const type = (mime ?? mimeFromUrl(url) ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (tag === "img") return "image";
  if (tag === "video") return "video";
  if (tag === "audio") return "audio";
  return "other";
}

export function extractMedia(html: string, base?: string): NormalizedMedia[] {
  const media: NormalizedMedia[] = [];
  const seen = new Set<string>();
  const add = (url: string, tag: string, alt?: string, mimeHint?: string) => {
    const resolved = resolveUrl(url, base);
    if (resolved === "" || seen.has(resolved)) return;
    seen.add(resolved);
    const mimeType = mimeHint?.trim().toLowerCase() || mimeFromUrl(resolved);
    media.push({
      url: resolved,
      kind: mediaKind(resolved, mimeType, tag),
      ...(alt?.trim() ? { alt: alt.trim() } : {}),
      ...(mimeType ? { mimeType } : {}),
    });
  };

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(match[0], "src");
    if (src) add(src, "img", attr(match[0], "alt"), attr(match[0], "type"));
  }
  for (const match of html.matchAll(/<video\b[^>]*>/gi)) {
    const src = attr(match[0], "src");
    if (src) {
      add(src, "video", attr(match[0], "title"), attr(match[0], "type"));
    }
  }
  for (const match of html.matchAll(/<audio\b[^>]*>/gi)) {
    const src = attr(match[0], "src");
    if (src) {
      add(src, "audio", attr(match[0], "title"), attr(match[0], "type"));
    }
  }
  for (const match of html.matchAll(/<source\b[^>]*>/gi)) {
    const src = attr(match[0], "src");
    const type = attr(match[0], "type");
    if (src) {
      const tag = type?.toLowerCase().startsWith("audio/")
        ? "audio"
        : type?.toLowerCase().startsWith("video/")
          ? "video"
          : "other";
      add(src, tag, undefined, type);
    }
  }
  return media;
}

export function htmlToMarkdown(html: string, base?: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<script\b[\s\S]*$/gi, "")
    .replace(/<style\b[\s\S]*$/gi, "")
    .replace(/<noscript\b[\s\S]*$/gi, "");

  out = out.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level, text) =>
      `\n${"#".repeat(Number(level))} ${decodeEntities(stripTags(text)).trim()}\n\n`,
  );
  out = out.replace(
    /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, code) => `\n\`\`\`\n${decodeEntities(code).trim()}\n\`\`\`\n\n`,
  );
  out = out.replace(
    /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
    (_, _raw, double, single, bare, text) => {
      const url = resolveUrl(double ?? single ?? bare ?? "", base);
      const label = decodeEntities(stripTags(text)).trim() || url;
      return url === "" ? label : `[${label}](${url})`;
    },
  );
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, "src");
    if (!src) return "";
    const url = resolveUrl(src, base);
    return url === ""
      ? ""
      : `![${decodeEntities(attr(tag, "alt") ?? "")}](${url})`;
  });
  out = out
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<li\b[^>]*>([\s\S]*?)<\/li>/gi,
      (_, text) => `\n- ${stripTags(text).trim()}`,
    )
    .replace(/<\/(ul|ol)>/gi, "\n")
    .replace(
      /<p\b[^>]*>([\s\S]*?)<\/p>/gi,
      (_, text) => `\n\n${stripTags(text).trim()}\n\n`,
    )
    .replace(
      /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_, text) => `\n> ${stripTags(text).trim()}\n\n`,
    )
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(out)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractHtml(html: string, base?: string): ExtractedPage {
  return {
    title: extractTitle(html),
    content: htmlToMarkdown(html, base),
    links: extractLinks(html, base),
    media: extractMedia(html, base),
  };
}
