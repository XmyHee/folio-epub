import { proposeFilename } from "./normalize";
import type { DerivedBook, DuplicateGroup, NamingMode, ParsedBook, PipelineResult } from "./types";

function scoreBook(book: ParsedBook): number {
  let s = 0;
  if (!book.hasZlibTag) s += 1000;
  if (book.status === "ok") s += 200;
  if (book.rawTitle) s += 120;
  if (book.authors.length > 0) s += 80;
  if (book.coverUrl) s += 40;
  if (book.publisher) s += 10;
  if (book.identifiers.length > 0) s += 10;
  s += Math.min(book.size / 1024, 400);
  s += Math.min(book.spineCount, 40);
  return s;
}

function uniqueName(desired: string, taken: Set<string>): string {
  if (!taken.has(desired.toLowerCase())) return desired;
  const stem = desired.replace(/\.epub$/i, "");
  let n = 2;
  while (taken.has(`${stem} (${n}).epub`.toLowerCase())) n += 1;
  return `${stem} (${n}).epub`;
}

export function runPipeline(
  books: ParsedBook[],
  mode: NamingMode,
  keepOverrides: Record<string, string> = {},
): PipelineResult {
  const derived: DerivedBook[] = books.map((book) => {
    const naming = proposeFilename(book.rawTitle, book.authors, book.originalName, mode);
    return {
      ...book,
      ...naming,
      groupId: null,
      role: "unique" as const,
      score: scoreBook(book),
      nameChanged: false,
    };
  });

  const groups: DuplicateGroup[] = [];

  const byHash = new Map<string, DerivedBook[]>();
  for (const book of derived) {
    if (!book.hash) continue;
    const list = byHash.get(book.hash) ?? [];
    list.push(book);
    byHash.set(book.hash, list);
  }

  for (const [hash, members] of byHash) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => b.score - a.score);
    const groupId = `hash:${hash.slice(0, 12)}`;
    const keep = sorted.find((m) => m.id === keepOverrides[groupId]) ?? sorted[0]!;
    for (const m of members) {
      m.groupId = groupId;
      m.role = m.id === keep.id ? "keep" : "identical";
    }
    groups.push({
      id: groupId,
      key: hash.slice(0, 16),
      kind: "hash",
      bookIds: members.map((m) => m.id),
      keepId: keep.id,
    });
  }

  const byKey = new Map<string, DerivedBook[]>();
  for (const book of derived) {
    if (book.role === "identical") continue;
    const list = byKey.get(book.bookKey) ?? [];
    list.push(book);
    byKey.set(book.bookKey, list);
  }

  for (const [key, members] of byKey) {
    if (members.length < 2 || !key) continue;
    const sorted = [...members].sort((a, b) => b.score - a.score);
    const groupId = `title:${key}`;
    const keep = sorted.find((m) => m.id === keepOverrides[groupId]) ?? sorted[0]!;
    for (const m of members) {
      m.groupId = groupId;
      m.role = m.id === keep.id ? "keep" : "duplicate";
    }
    groups.push({
      id: groupId,
      key,
      kind: "title",
      bookIds: members.map((m) => m.id),
      keepId: keep.id,
    });
  }

  const taken = new Set<string>();
  for (const book of derived) {
    if (book.role === "duplicate" || book.role === "identical") continue;
    const name = uniqueName(book.proposedName, taken);
    taken.add(name.toLowerCase());
    book.proposedName = name;
    book.nameChanged = name.toLowerCase() !== book.originalName.toLowerCase();
  }
  for (const book of derived) {
    if (book.role !== "duplicate" && book.role !== "identical") continue;
    const name = uniqueName(book.proposedName, taken);
    taken.add(name.toLowerCase());
    book.proposedName = name;
    book.nameChanged = name.toLowerCase() !== book.originalName.toLowerCase();
  }

  return {
    books: derived,
    groups,
    stats: {
      total: derived.length,
      parsed: derived.filter((b) => b.status === "ok").length,
      failed: derived.filter((b) => b.status === "error").length,
      willRename: derived.filter(
        (b) => b.nameChanged && b.role !== "duplicate" && b.role !== "identical",
      ).length,
      duplicateGroups: groups.length,
      toIsolate: derived.filter((b) => b.role === "duplicate" || b.role === "identical").length,
      exactCopies: derived.filter((b) => b.role === "identical").length,
    },
  };
}
