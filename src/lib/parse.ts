import JSZip from "jszip";
import { hasZlibTag } from "./normalize";
import type { ParsedBook } from "./types";

function uid(): string {
  return crypto.randomUUID();
}

function localName(el: Element): string {
  return el.localName || el.tagName.replace(/^.*:/, "");
}

function byLocal(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((el) => localName(el) === name);
}

function textOf(el: Element | undefined | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function attr(el: Element | undefined | null, name: string): string {
  if (!el) return "";
  return el.getAttribute(name) || el.getAttribute(name.toLowerCase()) || "";
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("OPF / container XML 解析失败");
  return doc;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function joinPath(base: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, "/");
  if (!base) return cleaned.replace(/^\.\//, "");
  const parts = `${base}/${cleaned}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function guessImageType(path: string, blob: Blob): string {
  if (blob.type && blob.type.startsWith("image/")) return blob.type;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    svg: "image/svg+xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
  };
  return map[ext] ?? "image/jpeg";
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function relativePathOf(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}

function findCoverPath(opf: Document, opfDir: string, metas: Element[]): string | null {
  const items = byLocal(opf, "item");
  const byId = new Map<string, Element>();
  for (const item of items) {
    const id = attr(item, "id");
    if (id) byId.set(id, item);
  }

  const coverProp = items.find((item) =>
    (attr(item, "properties") || "").split(/\s+/).includes("cover-image"),
  );
  if (coverProp) return joinPath(opfDir, attr(coverProp, "href"));

  for (const meta of metas) {
    if (attr(meta, "name").toLowerCase() === "cover") {
      const item = byId.get(attr(meta, "content"));
      if (item) return joinPath(opfDir, attr(item, "href"));
    }
  }

  const guideCover = byLocal(opf, "reference").find((ref) =>
    (attr(ref, "type") || "").toLowerCase().includes("cover"),
  );
  if (guideCover) {
    const href = attr(guideCover, "href");
    if (href && !/\.x?html?$/i.test(href)) return joinPath(opfDir, href);
  }

  const named = items.find((item) => {
    const id = attr(item, "id").toLowerCase();
    const href = attr(item, "href").toLowerCase();
    const type = attr(item, "media-type").toLowerCase();
    return type.startsWith("image/") && (id.includes("cover") || href.includes("cover"));
  });
  if (named) return joinPath(opfDir, attr(named, "href"));
  return null;
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const id = uid();
  const originalName = file.name;
  const relativePath = relativePathOf(file);
  const size = file.size;
  const zlib = hasZlibTag(originalName) || hasZlibTag(relativePath);

  const base: ParsedBook = {
    id,
    file,
    originalName,
    relativePath,
    size,
    hash: "",
    status: "ok",
    rawTitle: "",
    authors: [],
    publisher: "",
    language: "",
    identifiers: [],
    description: "",
    date: "",
    subjects: [],
    series: "",
    spineCount: 0,
    hasZlibTag: zlib,
  };

  try {
    const buffer = await file.arrayBuffer();
    base.hash = await sha256Hex(buffer);
    const zip = await JSZip.loadAsync(buffer);
    const containerFile =
      zip.file("META-INF/container.xml") || zip.file("meta-inf/container.xml");
    if (!containerFile) throw new Error("缺少 META-INF/container.xml，不是标准 EPUB");

    const containerDoc = parseXml(await containerFile.async("string"));
    const rootfile = byLocal(containerDoc, "rootfile")[0];
    const opfPath = attr(rootfile, "full-path").replace(/\\/g, "/");
    if (!opfPath) throw new Error("container.xml 未声明 OPF 路径");

    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error(`找不到 OPF 文件: ${opfPath}`);
    const opf = parseXml(await opfFile.async("string"));
    const opfDir = dirname(opfPath);

    base.rawTitle = byLocal(opf, "title").map(textOf).filter(Boolean)[0] ?? "";
    base.authors = Array.from(new Set(byLocal(opf, "creator").map(textOf).filter(Boolean)));
    base.publisher = byLocal(opf, "publisher").map(textOf).filter(Boolean)[0] ?? "";
    base.language = byLocal(opf, "language").map(textOf).filter(Boolean)[0] ?? "";
    base.identifiers = byLocal(opf, "identifier").map(textOf).filter(Boolean);
    base.description = byLocal(opf, "description").map(textOf).filter(Boolean)[0] ?? "";
    base.date = (byLocal(opf, "date").map(textOf).filter(Boolean)[0] ?? "").slice(0, 10);
    base.subjects = byLocal(opf, "subject").map(textOf).filter(Boolean);
    base.spineCount = byLocal(opf, "itemref").length;

    const metas = byLocal(opf, "meta");
    for (const meta of metas) {
      const property = attr(meta, "property").toLowerCase();
      const name = attr(meta, "name").toLowerCase();
      if (property.includes("belongs-to-collection") || name === "calibre:series") {
        const series = textOf(meta) || attr(meta, "content");
        if (series) base.series = series;
      }
    }

    const coverPath = findCoverPath(opf, opfDir, metas);
    if (coverPath) {
      const coverFile = zip.file(coverPath);
      if (coverFile) {
        const blob = await coverFile.async("blob");
        const typed = new Blob([blob], { type: guessImageType(coverPath, blob) });
        base.coverUrl = URL.createObjectURL(typed);
      }
    }

    if (!base.rawTitle && base.authors.length === 0) {
      base.status = "error";
      base.error = "EPUB 内部缺少书名与作者";
    }
    return base;
  } catch (err) {
    if (!base.hash) {
      try {
        base.hash = await sha256Hex(await file.arrayBuffer());
      } catch {
        base.hash = `fallback-${id}`;
      }
    }
    return {
      ...base,
      status: "error",
      error: err instanceof Error ? err.message : "读取解析失败",
    };
  }
}

export async function parseEpubBatch(
  files: File[],
  onProgress: (done: number, total: number, current: string) => void,
  concurrency = 4,
): Promise<ParsedBook[]> {
  const total = files.length;
  const results: ParsedBook[] = new Array(total);
  let next = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const file = files[i]!;
      onProgress(done, total, file.name);
      results[i] = await parseEpub(file);
      done += 1;
      onProgress(done, total, file.name);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(total, 1)) }, () => worker()),
  );
  return results;
}

export function revokeCovers(books: ParsedBook[]) {
  for (const book of books) {
    if (book.coverUrl) URL.revokeObjectURL(book.coverUrl);
  }
}
