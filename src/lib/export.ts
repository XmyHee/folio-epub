import JSZip from "jszip";
import type { DerivedBook } from "./types";

function csvCell(value: string | number | undefined | null): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function formatLabel(book: DerivedBook): string {
  if (book.kind === "pdf") return "PDF";
  if (book.kind === "epub") return "EPUB";
  const n = (book.originalName || "").toLowerCase();
  if (n.endsWith(".pdf")) return "PDF";
  if (n.endsWith(".epub")) return "EPUB";
  return book.kind || "";
}

export function toAuditCsv(books: DerivedBook[]): string {
  const header = [
    "格式",
    "原始文件名",
    "相对路径",
    "书名",
    "作者",
    "出版社",
    "语言",
    "ISBN/标识",
    "出版日期",
    "丛书",
    "建议文件名",
    "去重结果",
    "元数据来源",
    "文件大小",
    "SHA-256",
    "状态",
  ];
  const lines = [header.join(",")];
  for (const b of books) {
    const role =
      b.role === "keep"
        ? "保留最佳"
        : b.role === "duplicate"
          ? "重复副本"
          : b.role === "identical"
            ? "完全相同"
            : "唯一";
    const meta =
      b.metaSource === "openlibrary"
        ? "在线书目"
        : b.metaSource === "epub"
          ? "EPUB内置"
          : b.metaSource === "pdf"
            ? "PDF内置"
            : b.metaSource === "filename"
              ? "文件名"
              : b.metaSource || "";
    lines.push(
      [
        formatLabel(b),
        b.originalName,
        b.relativePath,
        b.resolvedTitle || b.rawTitle || (b.status === "error" ? "读取解析失败" : "【缺失书名】"),
        (b.resolvedAuthors && b.resolvedAuthors.length
          ? b.resolvedAuthors
          : b.authors
        ).join("; ") || (b.status === "error" ? (b.error ?? "") : "【缺失作者】"),
        b.publisher,
        b.language,
        b.identifiers.join("; "),
        b.date,
        b.series,
        b.proposedName,
        role,
        meta,
        b.size,
        b.hash,
        b.status === "ok" ? "OK" : (b.error ?? "ERROR"),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "\uFEFF" + lines.join("\n");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadCsv(books: DerivedBook[]) {
  downloadBlob(new Blob([toAuditCsv(books)], { type: "text/csv;charset=utf-8" }), "folio-audit.csv");
}

export async function downloadLibraryZip(
  books: DerivedBook[],
  opts: { includeDuplicates: boolean },
) {
  const zip = new JSZip();
  const kept = books.filter((b) => b.role === "unique" || b.role === "keep");
  const dropped = books.filter((b) => b.role === "duplicate" || b.role === "identical");

  for (const book of kept) zip.file("Library/" + book.proposedName, book.file);
  if (opts.includeDuplicates) {
    for (const book of dropped) zip.file("Duplicates/" + book.originalName, book.file);
  }

  try {
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "STORE",
      mimeType: "application/zip",
      streamFiles: true,
    });
    downloadBlob(blob, "folio-library.zip");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/array buffer allocation failed|out of memory|oom/i.test(msg)) {
      throw new Error(
        "导出时内存不足。请取消「ZIP 中保留重复副本」，或分批导入后再导出。",
      );
    }
    throw err;
  }
}
