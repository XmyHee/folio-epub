export function isBookFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return n.endsWith(".epub") || n.endsWith(".pdf");
}

/** @deprecated use isBookFile */
export function isEpubFile(file: File): boolean {
  return isBookFile(file);
}

type AnyEntry = {
  isFile: boolean;
  isDirectory: boolean;
  file?: (ok: (file: File) => void, err?: (e: Error) => void) => void;
  createReader?: () => {
    readEntries: (ok: (entries: AnyEntry[]) => void, err?: (e: Error) => void) => void;
  };
};

async function readAllEntries(
  reader: NonNullable<AnyEntry["createReader"]> extends () => infer R ? R : never,
): Promise<AnyEntry[]> {
  const out: AnyEntry[] = [];
  while (true) {
    const batch = await new Promise<AnyEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    out.push(...batch);
  }
  return out;
}

async function walkEntry(entry: AnyEntry, acc: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    if (isBookFile(file)) acc.push(file);
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await readAllEntries(entry.createReader());
    for (const child of children) await walkEntry(child, acc);
  }
}

export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const acc: File[] = [];
  const entries: AnyEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const anyItem = item as DataTransferItem & { webkitGetAsEntry?: () => AnyEntry | null };
    const entry = anyItem.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length > 0) {
    for (const entry of entries) await walkEntry(entry, acc);
    if (acc.length > 0) return acc;
  }
  return Array.from(dt.files ?? []).filter(isBookFile);
}

export function filesFromInput(list: FileList | null): File[] {
  if (!list) return [];
  return Array.from(list).filter(isBookFile);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return (value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)) + " " + units[i];
}
