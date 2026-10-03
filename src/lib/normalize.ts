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

const STOP_TITLE_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "with", "by",
]);

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

/** Stable author fingerprint: sorted alnum tokens, "Last, First" flipped */
export function authorFingerprint(authors: string[]): string {
  const tokens: string[] = [];
  for (const a of authors) {
    const n = normalizeAuthor(a);
    const parts = n
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((p) => p.length > 1);
    tokens.push(...parts);
  }
  return [...new Set(tokens)].sort().join(" ");
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

/** Title tokens for fuzzy match (drop short stopwords) */
export function titleTokens(title: string): string[] {
  const cleaned = stripVsiSuffix(stripZlibTag(title || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  return cleaned
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_TITLE_WORDS.has(t));
}

export function titleTokenSet(title: string): Set<string> {
  return new Set(titleTokens(title));
}

/** Jaccard similarity on title tokens, 0..1 */
export function titleSimilarity(a: string, b: string): number {
  const sa = titleTokenSet(a);
  const sb = titleTokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Extract ISBN-13 / ISBN-10 from identifier strings */
export function extractIsbns(identifiers: string[]): string[] {
  const out = new Set<string>();
  for (const raw of identifiers) {
    const digits = String(raw).replace(/[^0-9Xx]/g, "").toUpperCase();
    if (digits.length === 13 && /^97[89]/.test(digits)) out.add(digits);
    else if (digits.length === 10) out.add(digits);
    // urn:isbn:978-...
    const m = String(raw).match(/(?:isbn[:\s-]*)?(97[89][\d-]{10,}|\d[\d-]{8,}[\dXx])/i);
    if (m) {
      const d = m[1]!.replace(/[^0-9Xx]/g, "").toUpperCase();
      if (d.length === 13 || d.length === 10) out.add(d);
    }
  }
  return [...out];
}

/** Prefer ISBN-13 as canonical key when present */
export function primaryIsbn(identifiers: string[]): string | null {
  const all = extractIsbns(identifiers);
  const isbn13 = all.find((x) => x.length === 13);
  return isbn13 ?? all[0] ?? null;
}

export function looksLikeCopyName(name: string): boolean {
  return /(?:\bcopy\b|\(\d+\)|\bfinal\b|\bdownload\b|\bnew\b|\bv\d+\b|\brefinal\b)/i.test(
    name.replace(/\.epub$/i, ""),
  );
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
