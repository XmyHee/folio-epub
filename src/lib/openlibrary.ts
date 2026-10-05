/**
 * Lightweight Open Library ISBN lookup.
 * Offline / network failure → returns null (caller falls back to tier 2/3).
 */

export type OpenLibraryHit = {
  title: string;
  authors: string[];
  publisher?: string;
  publishDate?: string;
  isbn?: string;
  source: "openlibrary";
};

const cache = new Map<string, OpenLibraryHit | null>();

function normalizeIsbnKey(isbn: string): string {
  return isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
}

/** Batch Open Library books API (works in browser CORS) */
export async function lookupIsbn(isbn: string, signal?: AbortSignal): Promise<OpenLibraryHit | null> {
  const key = normalizeIsbnKey(isbn);
  if (!key || (key.length !== 10 && key.length !== 13)) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const bib = `ISBN:${key}`;
  const url =
    "https://openlibrary.org/api/books?bibkeys=" +
    encodeURIComponent(bib) +
    "&format=json&jscmd=data";

  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data = (await res.json()) as Record<
      string,
      {
        title?: string;
        authors?: Array<{ name?: string }>;
        publishers?: Array<{ name?: string }>;
        publish_date?: string;
        identifiers?: { isbn_13?: string[]; isbn_10?: string[] };
      }
    >;
    const entry = data[bib];
    if (!entry?.title) {
      cache.set(key, null);
      return null;
    }
    const hit: OpenLibraryHit = {
      title: entry.title.trim(),
      authors: (entry.authors ?? []).map((a) => (a.name ?? "").trim()).filter(Boolean),
      publisher: entry.publishers?.[0]?.name,
      publishDate: entry.publish_date,
      isbn: entry.identifiers?.isbn_13?.[0] ?? entry.identifiers?.isbn_10?.[0] ?? key,
      source: "openlibrary",
    };
    cache.set(key, hit);
    return hit;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/** Resolve many ISBNs with low concurrency to be polite to OL */
export async function lookupIsbnBatch(
  isbns: string[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 3,
): Promise<Map<string, OpenLibraryHit>> {
  const unique = [...new Set(isbns.map(normalizeIsbnKey).filter((x) => x.length === 10 || x.length === 13))];
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
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  const n = Math.min(concurrency, Math.max(unique.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export function clearOpenLibraryCache() {
  cache.clear();
}
