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
  return collapseWs(t).replace(/[-:\u2013\u2014,\s]+$/g, "").trim();
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

export function looksLikeVsi(text: string): boolean {
  return /very\s*short\s*introduction/i.test(text || "");
}

/**
 * Mode 1: clean title only (strip VSI / z-lib noise).
 * Mode 2: append real series from metadata when present;
 *         only add "(Very Short Introductions)" if this book itself was VSI.
 */

/** Drop incomplete trailing "(..." if parentheses are unbalanced */
function balanceParens(text: string): string {
  let opens = 0;
  for (const ch of text) {
    if (ch === "(") opens += 1;
    else if (ch === ")") opens = Math.max(0, opens - 1);
  }
  if (opens === 0) return text;
  const idx = text.lastIndexOf("(");
  if (idx > 0) {
    return text.slice(0, idx).replace(/[-:\u2013\u2014,\s]+$/g, "").trim();
  }
  return text;
}

export function sanitizeVsiTitle(
  title: string,
  mode: NamingMode,
  series?: string,
  originalHint?: string,
): string {
  if (!title) return "";
  const hadVsi = looksLikeVsi(title) || looksLikeVsi(originalHint || "");
  let t = stripVsiSuffix(stripZlibTag(collapseWs(title)));
  t = t.replace(/[-:\u2013\u2014,\s]+$/g, "").trim();
  t = balanceParens(t);
  if (mode === 2 && t) {
    const ser = (series || "").trim();
    if (ser) {
      const serClean = sanitizeFilenamePart(stripZlibTag(ser));
      if (serClean && !t.toLowerCase().includes(serClean.toLowerCase())) {
        t = t + " (" + serClean + ")";
      }
    } else if (hadVsi) {
      t = t + " (Very Short Introductions)";
    }
  }
  return sanitizeFilenamePart(t);
}


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


/** Normalize roman numerals / Chinese ordinals to a stable volume key */
const ROMAN: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
  xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15",
};

/**
 * Detect volume / part / 册 号 from title, series, or filename.
 * Different volume keys must NOT be treated as the same book.
 */
export function extractVolumeKey(...parts: Array<string | undefined | null>): string {
  const text = parts.filter(Boolean).join(" ");
  if (!text) return "";

  const patterns: RegExp[] = [
    /\b(?:vol(?:ume)?|v)\.?\s*([0-9]{1,3})\b/i,
    /\b(?:part|pt|book|bk|tome|band|bd)\.?\s*([0-9]{1,3})\b/i,
    /\b(?:part|pt)\.?\s*(i{1,3}|iv|vi{0,3}|ix|xi{0,2})\b/i,
    /\b([0-9]{1,3})\s*(?:st|nd|rd|th)?\s*(?:volume|vol|part|book)\b/i,
    /(?:第)\s*([0-9一二三四五六七八九十百]+)\s*(?:卷|册|部|集|篇)/,
    /([上中下全])\s*(?:卷|册|部|集)?/,
    /(?:^|[\s\-–—_])(上|中|下|全)(?:$|[\s\-–—_])/,
    /#\s*([0-9]{1,3})\b/,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    let raw = (m[1] || "").toLowerCase().trim();
    if (!raw) continue;
    const cn: Record<string, string> = {
      "一": "1", "二": "2", "三": "3", "四": "4", "五": "5",
      "六": "6", "七": "7", "八": "8", "九": "9", "十": "10",
      "上": "shang", "中": "zhong", "下": "xia", "全": "quan",
    };
    if (raw in cn) return cn[raw]!;
    if (raw in ROMAN) return ROMAN[raw]!;
    if (/^\d+$/.test(raw)) return String(parseInt(raw, 10));
    return raw;
  }
  return "";
}

/** Title with volume markers removed — for comparing series siblings */
export function titleWithoutVolume(title: string): string {
  let t = stripVsiSuffix(stripZlibTag(title || ""));
  t = t
    .replace(/\b(?:vol(?:ume)?|v)\.?\s*[0-9]{1,3}\b/gi, " ")
    .replace(/\b(?:part|pt|book|bk|tome)\.?\s*[0-9]{1,3}\b/gi, " ")
    .replace(/\b(?:part|pt)\.?\s*(?:i{1,3}|iv|vi{0,3}|ix|x)\b/gi, " ")
    .replace(/第\s*[0-9一二三四五六七八九十百]+\s*(?:卷|册|部|集|篇)/g, " ")
    .replace(/[上中下全]\s*(?:卷|册|部|集)?/g, " ")
    .replace(/#\s*[0-9]{1,3}\b/g, " ");
  return collapseWs(t);
}

export function looksLikeCopyName(name: string): boolean {
  // Do NOT treat Vol.N / volume numbers as "copy"
  return /(?:\bcopy\b|\bfinal\b|\bdownload\b|\brefinal\b|(?:^|[\s_\-])\(\d+\)(?:\.epub)?$)/i.test(
    name.replace(/\.epub$/i, ""),
  );
}

export function proposeFilename(
  title: string,
  authors: string[],
  originalName: string,
  mode: NamingMode,
  series?: string,
): { cleanTitle: string; displayAuthor: string; proposedName: string; bookKey: string } {
  const extMatch = originalName.match(/\.(epub|pdf)$/i);
  const ext = extMatch ? extMatch[0]!.toLowerCase() : ".epub";
  const fallbackTitle = stripVsiSuffix(
    stripZlibTag(originalName.replace(/\.(epub|pdf)$/i, "")),
  );
  const cleanTitle =
    sanitizeVsiTitle(title, mode, series, originalName) || sanitizeFilenamePart(fallbackTitle) || "Untitled";
  const displayAuthor = joinAuthors(authors);
  const proposedName =
    cleanTitle + " - " + sanitizeFilenamePart(displayAuthor) + ext;
  const keyTitle =
    cleanKeyText(titleWithoutVolume(title || originalName)) || cleanKeyText(originalName);
  const keyAuthor = cleanKeyText(displayAuthor === "Unknown" ? "" : displayAuthor);
  const vol = extractVolumeKey(title, originalName);
  const base = keyAuthor
    ? keyTitle + "_" + keyAuthor
    : keyTitle || "file_" + alnumKey(originalName);
  const bookKey = vol ? base + "_v" + vol : base;
  return { cleanTitle, displayAuthor, proposedName, bookKey };
}
