/**
 * ISBN catalog lookup: Google Books (primary) → Open Library (fallback).
 * Matches the priority used in rename_pdf_isbn.py.
 * Offline / failure → null (caller uses EPUB/PDF meta or filename).
 */

export type OpenLibraryHit = {
  title: string;
  authors: string[];
  publisher?: string;
  publishDate?: string;
  isbn?: string;
  source: "google" | "openlibrary";
};

const cache = new Map<string, OpenLibraryHit | null>();

function normalizeIsbnKey(isbn: string): string {
  return isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function cleanText(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

async function fetchGoogleBooks(isbn: string, signal?: AbortSignal): Promise<OpenLibraryHit | null> {
  const url = "https://www.googleapis.com/books/v1/volumes?q=isbn:" + encodeURIComponent(isbn);
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Folio-EPUB-Organizer/1.0",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: Array<{
        volumeInfo?: {
          title?: string;
          subtitle?: string;
          authors?: string[];
          publisher?: string;
          publishedDate?: string;
        };
      }>;
    };
    const info = data.items?.[0]?.volumeInfo;
    if (!info?.title) return null;
    let title = cleanText(info.title);
    const subtitle = cleanText(info.subtitle);
    if (subtitle && !title.toLowerCase().includes(subtitle.toLowerCase())) {
      title = title + ": " + subtitle;
    }
    return {
      title,
      authors: (info.authors ?? []).map(cleanText).filter(Boolean),
      publisher: cleanText(info.publisher) || undefined,
      publishDate: info.publishedDate,
      isbn,
      source: "google",
    };
  } catch {
    return null;
  }
}

async function fetchOpenLibrary(isbn: string, signal?: AbortSignal): Promise<OpenLibraryHit | null> {
  const bib = "ISBN:" + isbn;
  const url =
    "https://openlibrary.org/api/books?bibkeys=" +
    encodeURIComponent(bib) +
    "&format=json&jscmd=data";
  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<
      string,
      {
        title?: string;
        subtitle?: string;
        authors?: Array<{ name?: string }>;
        publishers?: Array<{ name?: string }>;
        publish_date?: string;
      }
    >;
    const entry = data[bib];
    if (!entry?.title) return null;
    let title = cleanText(entry.title);
    const subtitle = cleanText(entry.subtitle);
    if (subtitle && !title.toLowerCase().includes(subtitle.toLowerCase())) {
      title = title + ": " + subtitle;
    }
    return {
      title,
      authors: (entry.authors ?? []).map((a) => cleanText(a.name)).filter(Boolean),
      publisher: entry.publishers?.[0]?.name,
      publishDate: entry.publish_date,
      isbn,
      source: "openlibrary",
    };
  } catch {
    return null;
  }
}

/** Google Books first, then Open Library */
export async function lookupIsbn(isbn: string, signal?: AbortSignal): Promise<OpenLibraryHit | null> {
  const key = normalizeIsbnKey(isbn);
  if (!key || (key.length !== 10 && key.length !== 13)) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  let hit = await fetchGoogleBooks(key, signal);
  if (!hit) hit = await fetchOpenLibrary(key, signal);
  cache.set(key, hit);
  return hit;
}

export async function lookupIsbnBatch(
  isbns: string[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 2,
): Promise<Map<string, OpenLibraryHit>> {
  const unique = [
    ...new Set(isbns.map(normalizeIsbnKey).filter((x) => x.length === 10 || x.length === 13)),
  ];
  const out = new Map<string, OpenLibraryHit>();
  let done = 0;
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= unique.length) return;
      const isbn = unique[i]!;
      const hit = await lookupIsbn(isbn);
      if (hit) out.set(isbn, hit);
      done += 1;
      onProgress?.(done, unique.length);
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  const n = Math.min(concurrency, Math.max(unique.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export function clearOpenLibraryCache() {
  cache.clear();
}
