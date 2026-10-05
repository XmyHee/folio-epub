import { extractIsbns, primaryIsbn, stripZlibTag, stripVsiSuffix, collapseWs } from "./normalize";
import type { OpenLibraryHit } from "./openlibrary";
import type { MetaSource, ParsedBook } from "./types";

const SKIP_AUTHOR_KEYWORDS = [
  "z-lib",
  "1lib",
  "pdfdrive",
  "org",
  "sk",
  "com",
  "epub",
  "pdf",
  "zlib",
];

/**
 * Tier 3: filename regex (aligned with rename_pdf_isbn.py)
 *  - "Title (Author) (z-library...)"
 *  - "Title - Author"
 */
export function metaFromFilename(originalName: string): {
  title: string;
  authors: string[];
} {
  let stem = originalName.replace(/\.(epub|pdf)$/i, "");
  stem = stripZlibTag(stem);
  stem = stem.replace(/[\[\(]z-?lib[^\])]*[\]\)]/gi, " ");
  stem = collapseWs(stem);

  // Title (Author) (optional other parens)
  const paren = stem.match(/^(.*?)\s*\(([^()]+)\)(?:\s*\([^()]+\))*$/);
  if (paren) {
    const rawTitle = collapseWs(paren[1] || "");
    const rawAuthor = collapseWs(paren[2] || "");
    if (rawAuthor && !SKIP_AUTHOR_KEYWORDS.some((k) => rawAuthor.toLowerCase().includes(k))) {
      return { title: stripVsiSuffix(rawTitle), authors: [rawAuthor] };
    }
  }

  // Title - Author
  if (stem.includes(" - ")) {
    const parts = stem.split(" - ");
    if (parts.length >= 2) {
      const left = collapseWs(parts[0] || "");
      const right = collapseWs(parts.slice(1).join(" - "));
      const rightLooksAuthor =
        right.split(/\s+/).length <= 6 &&
        !/\bvol(?:ume)?\.?\s*\d/i.test(right) &&
        !SKIP_AUTHOR_KEYWORDS.some((k) => right.toLowerCase().includes(k));
      if (rightLooksAuthor) {
        return { title: stripVsiSuffix(left), authors: [right] };
      }
    }
  }

  return { title: stripVsiSuffix(collapseWs(stem)), authors: [] };
}

export type ResolveOptions = {
  olByIsbn?: Map<string, OpenLibraryHit>;
  online?: boolean;
};

/**
 * 1. ISBN → Google Books / Open Library
 * 2. EPUB/PDF internal metadata
 * 3. Filename regex
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
    primaryIsbn(extractIsbns([book.originalName + " " + (book.rawTitle || "")]));

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

  const fromName = metaFromFilename(book.originalName);
  return {
    title: fromName.title || "Untitled",
    authors: fromName.authors,
    publisher: book.publisher,
    source: fromName.title ? "filename" : "none",
    isbn: isbn,
  };
}
