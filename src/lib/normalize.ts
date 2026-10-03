import type { NamingMode } from "./types";

const VSI_PATTERNS = [
  /[\:\-\u2013\u2014,]\s*a?\s*very\s*short\s*introduction\b/gi,
  /\(very\s*short\s*introductions?\)/gi,
  /\[very\s*short\s*introductions?\]/gi,
  /\ba?\s*very\s*short\s*introduction\b/gi,
  /\bvery\s*short\s*introductions\b/gi,
];

const ZLIB_PATTERNS = [
  /\(z-library.*?\)/gi,
  /\[z-library.*?\]/gi,
  /\bz-library(?:\.org|\.se)?\b/gi,
];

const WINDOWS_FORBIDDEN = /[\\/:*?"<>|]/g;

export function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function stripVsiSuffix(text: string): string {
  let t = text;
  for (const pat of VSI_PATTERNS) t = t.replace(pat, " ");
  return collapseWs(t).replace(/[-:\u2013\u2014,()[\]]+$/g, "").trim();
}

export function stripZlibTag(text: string): string {
  let t = text;
  for (const pat of ZLIB_PATTERNS) t = t.replace(pat, " ");
  return collapseWs(t);
}

export function hasZlibTag(name: string): boolean {
  return /z-library/i.test(name);
}

export function alnumKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function cleanKeyText(text: string | undefined | null): string {
  if (!text) return "";
  return alnumKey(stripVsiSuffix(stripZlibTag(String(text))));
}

export function sanitizeFilenamePart(text: string): string {
  const cleaned = collapseWs(text.replace(WINDOWS_FORBIDDEN, "_")).replace(/^\.+/, "");
  return cleaned.slice(0, 160);
}

export function normalizeAuthor(raw: string): string {
  const t = collapseWs(stripZlibTag(raw));
  if (!t) return "";
  if (/^[^,]+,\s*[^,]+$/.test(t) && !/\d/.test(t)) {
    const [last, first] = t.split(",").map((s) => s.trim());
    if (first && last && first.split(" ").length <= 3 && last.split(" ").length <= 3) {
      return `${first} ${last}`;
    }
  }
  return t;
}

export function joinAuthors(authors: string[]): string {
  const names = authors.map(normalizeAuthor).filter(Boolean);
  if (names.length === 0) return "Unknown";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export function sanitizeVsiTitle(title: string, mode: NamingMode): string {
  if (!title) return "";
  let t = stripVsiSuffix(stripZlibTag(collapseWs(title)));
  t = t.replace(/[-:\u2013\u2014,()[\]]+$/g, "").trim();
  if (mode === 2 && t) t = `${t} (Very Short Introductions)`;
  return sanitizeFilenamePart(t);
}

export function proposeFilename(
  title: string,
  authors: string[],
  originalName: string,
  mode: NamingMode,
): { cleanTitle: string; displayAuthor: string; proposedName: string; bookKey: string } {
  const fallbackTitle = stripVsiSuffix(stripZlibTag(originalName.replace(/\.epub$/i, "")));
  const cleanTitle =
    sanitizeVsiTitle(title, mode) || sanitizeFilenamePart(fallbackTitle) || "Untitled";
  const displayAuthor = joinAuthors(authors);
  const proposedName = `${cleanTitle} - ${sanitizeFilenamePart(displayAuthor)}.epub`;
  const keyTitle = cleanKeyText(title) || cleanKeyText(originalName);
  const keyAuthor = cleanKeyText(displayAuthor === "Unknown" ? "" : displayAuthor);
  const bookKey = keyAuthor
    ? `${keyTitle}_${keyAuthor}`
    : keyTitle || `file_${alnumKey(originalName)}`;
  return { cleanTitle, displayAuthor, proposedName, bookKey };
}
