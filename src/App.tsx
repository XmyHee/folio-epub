import { useMemo, useRef, useState, type DragEvent } from "react";
import { downloadCsv, downloadLibraryZip } from "./lib/export";
import { filesFromDataTransfer, filesFromInput, formatBytes } from "./lib/files";
import { parseEpubBatch, revokeCovers } from "./lib/parse";
import { lookupIsbnBatch } from "./lib/openlibrary";
import { primaryIsbn } from "./lib/normalize";
import { runPipeline } from "./lib/pipeline";
import type { DerivedBook, NamingMode, ParsedBook } from "./lib/types";

const ROLE_LABEL: Record<DerivedBook["role"], { text: string; cls: string }> = {
  unique: { text: "唯一", cls: "badge-accent" },
  keep: { text: "保留", cls: "badge-keep" },
  duplicate: { text: "重复", cls: "badge-drop" },
  identical: { text: "相同", cls: "badge-drop" },
};

function Cover({ src }: { src?: string }) {
  return (
    <div className="cover" aria-hidden>
      {src ? <img src={src} alt="" /> : "EPUB"}
    </div>
  );
}

export default function App() {
  const [books, setBooks] = useState<ParsedBook[]>([]);
  const [namingMode, setNamingMode] = useState<NamingMode>(1);
  const [useOnlineMeta, setUseOnlineMeta] = useState(true);
  const [olProgress, setOlProgress] = useState<string | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(true);
  const [keepOverrides, setKeepOverrides] = useState<Record<string, string>>({});
  const [olByIsbn, setOlByIsbn] = useState<Map<string, import("./lib/openlibrary").OpenLibraryHit>>(new Map());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"audit" | "rename" | "dedupe">("audit");
  const [selected, setSelected] = useState<DerivedBook | null>(null);
  const [exporting, setExporting] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const pipeline = useMemo(
    () => runPipeline(books, namingMode, keepOverrides),
    [books, namingMode, keepOverrides],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pipeline.books;
    return pipeline.books.filter((b) =>
      [b.rawTitle, b.originalName, b.proposedName, b.displayAuthor, b.publisher]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [pipeline.books, query]);

  const renameBooks = filtered.filter((b) => b.role === "unique" || b.role === "keep");

    async function ingest(files: File[]) {
    if (files.length === 0) {
      setError("没有找到 EPUB / PDF 文件");
      return;
    }
    revokeCovers(books);
    setBusy(true);
    setError(null);
    setOlProgress(null);
    setBooks([]);
    setOlByIsbn(new Map());
    setKeepOverrides({});
    setSelected(null);
    setProgress({ done: 0, total: files.length, current: files[0]?.name ?? "" });
    try {
      const parsed = await parseEpubBatch(files, (done, total, current) => {
        setProgress({ done, total, current });
      });

      // Tier-1 prep: collect ISBNs and optionally query Open Library
      if (useOnlineMeta) {
        const isbns = parsed
          .map((b) => b.isbn || primaryIsbn(b.identifiers) || "")
          .filter(Boolean);
        if (isbns.length > 0) {
          setOlProgress("Open Library 查询中…");
          try {
            const hits = await lookupIsbnBatch(isbns, (done, total) => {
              setOlProgress("Open Library " + done + "/" + total);
            });
            setOlByIsbn(hits);
          } catch {
            // offline / blocked — silent fallback to tier 2/3
          }
          setOlProgress(null);
        }
      }

      setBooks(parsed);
      setTab("audit");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "解析失败";
      setError(
        /array buffer|内存|oom/i.test(msg)
          ? "浏览器内存不足。请分批导入，每次少选一些书。"
          : msg,
      );
    } finally {
      setBusy(false);
      setProgress(null);
      setOlProgress(null);
    }
  }

  function clearAll() {
    revokeCovers(books);
    setBooks([]);
    setKeepOverrides({});
    setSelected(null);
    setQuery("");
    setError(null);
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    const files = await filesFromDataTransfer(e.dataTransfer);
    await ingest(files);
  }

  async function handleExport() {
    if (pipeline.books.length === 0) return;
    setExporting(true);
    try {
      await downloadLibraryZip(pipeline.books, { includeDuplicates });
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  const ratio =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="kicker">Folio</p>
          <h1>把散乱的 EPUB 整理成一座干净书库</h1>
          <p className="lead">
            依次读取内部元数据、按书名与作者命名、再按指纹与书目去重。文件只在本机浏览器处理，不会上传。
          </p>
        </div>
        <p className="hint">文件不出浏览器 · 可部署到 GitHub Pages</p>
      </header>

      <div
        className="panel"
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className={`drop${over ? " over" : ""}`}>
          <h2>把 EPUB 拖到这里</h2>
          <p>支持多文件或整个文件夹。解析书名、作者、封面与 ISBN，再规范命名并去重。</p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              选择文件
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => folderRef.current?.click()}
            >
              选择文件夹
            </button>
            {books.length > 0 ? (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={clearAll}>
                清空
              </button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".epub,.pdf,application/epub+zip,application/pdf"
            multiple
            className="hidden-input"
            onChange={(e) => {
              void ingest(filesFromInput(e.target.files));
              e.target.value = "";
            }}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            // @ts-expect-error non-standard
            webkitdirectory=""
            className="hidden-input"
            onChange={(e) => {
              void ingest(filesFromInput(e.target.files));
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {busy && progress ? (
        <div className="progress">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
            <span style={{ color: "var(--muted)" }}>正在读取内部元数据</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="bar" style={{ marginTop: "0.5rem" }}>
            <div style={{ width: `${ratio}%` }} />
          </div>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--faint)" }}>
            {progress.current}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      {pipeline.stats.total > 0 ? (
        <>
          <div className="stats">
            <div className="stat">
              <label>已扫描</label>
              <strong>{pipeline.stats.total}</strong>
            </div>
            <div className="stat">
              <label>将重命名</label>
              <strong>{pipeline.stats.willRename}</strong>
            </div>
            <div className="stat">
              <label>重复组</label>
              <strong>{pipeline.stats.duplicateGroups}</strong>
            </div>
            <div className="stat">
              <label>将隔离</label>
              <strong>{pipeline.stats.toIsolate}</strong>
            </div>
          </div>

          <div className="toolbar">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
              <div className="seg">
                <button
                  type="button"
                  className={namingMode === 1 ? "active" : ""}
                  onClick={() => setNamingMode(1)}
                >
                  纯书名
                </button>
                <button
                  type="button"
                  className={namingMode === 2 ? "active" : ""}
                  onClick={() => setNamingMode(2)}
                >
                  丛书后缀
                </button>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={includeDuplicates}
                  onChange={(e) => setIncludeDuplicates(e.target.checked)}
                />
                ZIP 中保留重复副本
              </label>
            </div>
            <div className="actions" style={{ marginTop: 0, justifyContent: "flex-start" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => downloadCsv(pipeline.books)}
              >
                导出 CSV
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={exporting}
                onClick={() => void handleExport()}
              >
                {exporting ? "打包中…" : "下载整理书库"}
              </button>
            </div>
          </div>

          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书名、作者或文件名"
          />

          <div className="tabs">
            <button
              type="button"
              className={tab === "audit" ? "active" : ""}
              onClick={() => setTab("audit")}
            >
              审计 {pipeline.stats.total}
            </button>
            <button
              type="button"
              className={tab === "rename" ? "active" : ""}
              onClick={() => setTab("rename")}
            >
              命名 {pipeline.stats.willRename}
            </button>
            <button
              type="button"
              className={tab === "dedupe" ? "active" : ""}
              onClick={() => setTab("dedupe")}
            >
              去重 {pipeline.stats.duplicateGroups}
            </button>
          </div>

          {tab === "audit" ? (
            <>
              <div className="mobile-cards">
                {filtered.length === 0 ? (
                  <p className="empty">没有符合筛选的图书。</p>
                ) : (
                  filtered.map((book) => (
                    <button
                      key={book.id}
                      type="button"
                      className="card-row"
                      onClick={() => setSelected(book)}
                    >
                      <Cover src={book.coverUrl} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {book.resolvedTitle || book.rawTitle || "【缺失书名】"}
                          {book.metaSource ? (
                            <span className="badge" style={{ marginLeft: 6, fontSize: "0.7rem" }}>
                              {book.metaSource === "openlibrary"
                                ? "OL"
                                : book.metaSource === "epub"
                                  ? "EPUB"
                                  : book.metaSource === "pdf"
                                    ? "PDF"
                                    : book.metaSource === "filename"
                                      ? "文件名"
                                      : ""}
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          {book.displayAuthor}
                        </div>
                        <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          <span className={`badge ${ROLE_LABEL[book.role].cls}`}>
                            {ROLE_LABEL[book.role].text}
                          </span>
                          {book.hasZlibTag ? <span className="badge badge-warn">zlib</span> : null}
                          {book.status === "error" ? (
                            <span className="badge badge-drop">失败</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="desktop-table table-wrap">
                {filtered.length === 0 ? (
                  <p className="empty">没有符合筛选的图书。</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>书目</th>
                        <th>原始文件名</th>
                        <th>体积</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((book) => (
                        <tr key={book.id}>
                          <td>
                            <button
                              type="button"
                              className="book-cell"
                              onClick={() => setSelected(book)}
                            >
                              <Cover src={book.coverUrl} />
                              <span>
                                <span>{book.rawTitle || "【缺失书名】"}</span>
                                <span className="meta">{book.displayAuthor}</span>
                              </span>
                            </button>
                          </td>
                          <td
                            style={{
                              fontFamily: "ui-monospace, monospace",
                              fontSize: "0.75rem",
                              color: "var(--muted)",
                              maxWidth: "16rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {book.originalName}
                          </td>
                          <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
                            {formatBytes(book.size)}
                          </td>
                          <td>
                            <span className={`badge ${ROLE_LABEL[book.role].cls}`}>
                              {ROLE_LABEL[book.role].text}
                            </span>{" "}
                            {book.hasZlibTag ? <span className="badge badge-warn">zlib</span> : null}{" "}
                            {book.status === "error" ? (
                              <span className="badge badge-drop">失败</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : null}

          {tab === "rename" ? (
            <div className="list">
              {renameBooks.length === 0 ? (
                <p className="empty">没有需要重命名的文件。</p>
              ) : (
                renameBooks.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    className="list-item"
                    onClick={() => setSelected(book)}
                  >
                    <div className="old">{book.originalName}</div>
                    <div className="new">→ {book.proposedName}</div>
                  </button>
                ))
              )}
            </div>
          ) : null}

          {tab === "dedupe" ? (
            pipeline.groups.length === 0 ? (
              <p className="empty">没有发现重复项。</p>
            ) : (
              pipeline.groups.map((group) => {
                const members = group.bookIds
                  .map((id) => pipeline.books.find((b) => b.id === id))
                  .filter(Boolean) as DerivedBook[];
                const title =
                  members.find((m) => m.rawTitle)?.rawTitle ||
                  members[0]?.cleanTitle ||
                  group.key;
                return (
                  <section key={group.id} className="group">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
                      <h3 style={{ margin: 0 }}>{title}</h3>
                      <span className={`badge ${group.kind === "hash" || group.kind === "isbn" ? "badge-warn" : group.kind === "fuzzy" ? "badge-accent" : ""}`}>
                        {group.kind === "hash"
                          ? "内容完全相同"
                          : group.kind === "isbn"
                            ? "ISBN 相同"
                            : group.kind === "fuzzy"
                              ? "书名相似"
                              : "书名作者相同"}
                      </span>
                      {group.reason ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--faint)" }}>{group.reason}</span>
                      ) : null}
                      <span style={{ fontSize: "0.75rem", color: "var(--faint)" }}>
                        {members.length} 个版本
                      </span>
                    </div>
                    {members.map((book) => {
                      const kept = book.id === group.keepId;
                      return (
                        <div key={book.id} className="member">
                          <Cover src={book.coverUrl} />
                          <div className="info">
                            <button
                              type="button"
                              className="name"
                              style={{
                                border: "none",
                                background: "transparent",
                                color: "inherit",
                                font: "inherit",
                                padding: 0,
                                cursor: "pointer",
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                              }}
                              onClick={() => setSelected(book)}
                            >
                              {book.originalName}
                            </button>
                            <div className="sub">
                              {book.displayAuthor} · {formatBytes(book.size)}
                              {book.hasZlibTag ? " · z-library" : ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ height: "2.25rem", padding: "0 0.5rem" }}
                            onClick={() =>
                              setKeepOverrides((prev) => ({ ...prev, [group.id]: book.id }))
                            }
                          >
                            <span className={`badge ${kept ? "badge-keep" : "badge-drop"}`}>
                              {kept ? "保留" : "隔离"}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </section>
                );
              })
            )
          ) : null}

          {pipeline.stats.failed > 0 ? (
            <p style={{ fontSize: "0.75rem", color: "var(--warn)", marginTop: "1rem" }}>
              {pipeline.stats.failed}{" "}
              本无法可靠读取内部元数据，仍会按文件名参与命名，但不作为可靠书目。
            </p>
          ) : null}
        </>
      ) : !busy ? (
        <div className="steps">
          <div className="step">
            <div className="n">01</div>
            <h3>审计</h3>
            <p>打开 EPUB（ZIP + OPF），读取书名、作者、出版社、ISBN 与封面。</p>
          </div>
          <div className="step">
            <div className="n">02</div>
            <h3>命名</h3>
            <p>去掉 VSI / z-library 杂质，统一为「书名 - 作者.epub」。</p>
          </div>
          <div className="step">
            <div className="n">03</div>
            <h3>去重</h3>
            <p>SHA-256 → ISBN → 精确书名作者 → 模糊书名；按质量分保留最优。</p>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div
          className="dialog-backdrop"
          onClick={() => setSelected(null)}
          onKeyDown={(e) => e.key === "Escape" && setSelected(null)}
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="dialog-close" onClick={() => setSelected(null)}>
              ×
            </button>
            <h2 id="detail-title">内部元数据</h2>
            <p className="sub">从 EPUB 的 OPF 包文档读取，而不是文件名。</p>
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
              <div className="cover" style={{ width: "5rem", height: "7.5rem" }}>
                {selected.coverUrl ? <img src={selected.coverUrl} alt="" /> : "EPUB"}
              </div>
              <div>
                <div style={{ fontFamily: "var(--display)", fontSize: "1.1rem", fontWeight: 500 }}>
                  {selected.rawTitle || "【缺失书名】"}
                </div>
                <div style={{ color: "var(--muted)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
                  {selected.displayAuthor}
                </div>
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  <span className={`badge ${ROLE_LABEL[selected.role].cls}`}>
                    {ROLE_LABEL[selected.role].text}
                  </span>
                  {selected.hasZlibTag ? <span className="badge badge-warn">z-library</span> : null}
                  {selected.status === "error" ? (
                    <span className="badge badge-drop">解析失败</span>
                  ) : null}
                </div>
              </div>
            </div>
            <dl className="dl">
              <dt>原始文件名</dt>
              <dd>{selected.originalName}</dd>
              <dt>建议文件名</dt>
              <dd>{selected.proposedName}</dd>
              <dt>作者</dt>
              <dd>{selected.authors.join(" · ") || "—"}</dd>
              <dt>出版社</dt>
              <dd>{selected.publisher || "—"}</dd>
              <dt>语言</dt>
              <dd>{selected.language || "—"}</dd>
              <dt>标识符</dt>
              <dd>{selected.identifiers.join(" · ") || "—"}</dd>
              <dt>日期</dt>
              <dd>{selected.date || "—"}</dd>
              <dt>丛书</dt>
              <dd>{selected.series || "—"}</dd>
              <dt>体积</dt>
              <dd>{formatBytes(selected.size)}</dd>
              <dt>SHA-256</dt>
              <dd className="mono">{selected.hash}</dd>
              {selected.error ? (
                <>
                  <dt>错误</dt>
                  <dd>{selected.error}</dd>
                </>
              ) : null}
            </dl>
            {selected.description ? (
              <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "var(--muted)" }}>
                {selected.description}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
