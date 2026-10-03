export type ParseStatus = "ok" | "error";
export type NamingMode = 1 | 2;
export type DedupeRole = "unique" | "keep" | "duplicate" | "identical";

export type ParsedBook = {
  id: string;
  file: File;
  originalName: string;
  relativePath: string;
  size: number;
  hash: string;
  status: ParseStatus;
  error?: string;
  rawTitle: string;
  authors: string[];
  publisher: string;
  language: string;
  identifiers: string[];
  description: string;
  date: string;
  subjects: string[];
  series: string;
  coverUrl?: string;
  spineCount: number;
  hasZlibTag: boolean;
};

export type DerivedBook = ParsedBook & {
  cleanTitle: string;
  displayAuthor: string;
  proposedName: string;
  bookKey: string;
  groupId: string | null;
  role: DedupeRole;
  score: number;
  nameChanged: boolean;
};

export type DuplicateGroup = {
  id: string;
  key: string;
  kind: "hash" | "title";
  bookIds: string[];
  keepId: string;
};

export type PipelineResult = {
  books: DerivedBook[];
  groups: DuplicateGroup[];
  stats: {
    total: number;
    parsed: number;
    failed: number;
    willRename: number;
    duplicateGroups: number;
    toIsolate: number;
    exactCopies: number;
  };
};
