import { extractIsbns, primaryIsbn, stripZlibTag, stripVsiSuffix, collapseWs } from "./normalize";
import type { OpenLibraryHit } from "./openlibrary";
import type { MetaSource, ParsedBook } from "./types";

/**
 * Tier 3: derive title/author from filename with light regex cleaning.
 * e.g. "Collected Shorter Fiction, Vol. 1 - Leo Tolstoy.epub"
 */
export function metaFromFilename(originalName: string): {
  title: string;
  authors: string[];
} {
  let stem = originalName.replace(/\.(epub|pdf)$/i, "");
  stem = stripZlibTag(stem);
  stem = stem.replace(/[\[\(]z-?lib[^\])]*[\]\)]/gi, " ");
  stem = collapseWs(stem);

  // Pattern: Title - Author  OR  Title_Author  OR  Author - Title (heuristic)
  let title = stem;
  let authors: string[] = [];

  const dash = stem.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    const left = dash[1]!.trim();
    const right = dash[2]!.trim();
    // Prefer "Title - Author" when right looks like a person name (few words, no Vol.)
    const rightLooksAuthor =
      right.split(/\s+/).length <= 5 &&
      !/\bvol(?:ume)?\.?\s*\d/i.test(right) &&
      !/\d{4}/.test(right);
    if (rightLooksAuthor) {
      title = left;
      authors = [right];
    } else {
      title = stem;
    }
  }

  title = stripVsiSuffix(title);
  title = collapseWs(title.replace(/[_\.]+/g, " "));
  return { title, authors };
}

export type ResolveOptions = {
  /** Open Library hits keyed by normalized ISBN */
  olByIsbn?: Map<string, OpenLibraryHit>;
  /** If false, skip tier 1 even when ISBN present */
  online?: boolean;
};

/**
 * Three-tier metadata resolution (automatic fallback):
 *  1. ISBN → Open Library
 *  2. EPUB/PDF internal metadata
 *  3. Filename regex cleaning
 */
export function resolveBookMeta(
  book: ParsedBook,
  opts: ResolveOptions = {},
): {
  title: string;
  authors: string[];
  publisher: string;
  source: MetaSource;
  isbn: string | null;
} {
  const isbn =
    book.isbn ??
    primaryIsbn(book.identifiers) ??
    primaryIsbn(extractIsbnsFromText(book.originalName + " " + (book.rawTitle || "")));

  // ── Tier 1: Open Library by ISBN ───────────────────────────────────
  if (opts.online !== false && isbn && opts.olByIsbn) {
    const key = isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
    const hit = opts.olByIsbn.get(key);
    if (hit?.title) {
      return {
        title: hit.title,
        authors: hit.authors.length ? hit.authors : book.authors,
        publisher: hit.publisher || book.publisher,
        source: "openlibrary",
        isbn: key,
      };
    }
  }

  // ── Tier 2: internal EPUB / PDF metadata ───────────────────────────
  const internalTitle = (book.rawTitle || "").trim();
  const internalAuthors = book.authors.filter(Boolean);
  if (internalTitle || internalAuthors.length > 0) {
    const fromFile = metaFromFilename(book.originalName);
    return {
      title: internalTitle || fromFile.title,
      authors: internalAuthors.length ? internalAuthors : fromFile.authors,
      publisher: book.publisher,
      source: book.kind === "pdf" ? "pdf" : "epub",
      isbn: isbn,
    };
  }

  // ── Tier 3: filename ───────────────────────────────────────────────
  const fromName = metaFromFilename(book.originalName);
  return {
    title: fromName.title || "Untitled",
    authors: fromName.authors,
    publisher: book.publisher,
    source: fromName.title ? "filename" : "none",
    isbn: isbn,
  };
}

function extractIsbnsFromText(text: string): string[] {
  return extractIsbns([text]);
}
