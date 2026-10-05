# 📚 Folio Library

> 一个轻量、优雅且现代化的个人数字书坊（支持 **EPUB** 与 **PDF** 双格式），集成本地预处理、自动封面抽取与 GitHub Pages 自动化部署。

[![Deploy to GitHub Pages](https://github.com/XmyHee/folio-library/actions/workflows/deploy.yml/badge.svg)](https://github.com/XmyHee/folio-library/actions/workflows/deploy.yml)
![Supported Formats](https://img.shields.io/badge/Formats-EPUB%20%7C%20PDF-blue.svg)

🌐 **在线演示**：[https://xmyhee.github.io/folio-library/](https://xmyhee.github.io/folio-library/)

---

## ✨ 核心特性

- 📖 **多格式兼容**：原生支持 EPUB 与 PDF 双格式电子书。
- 🖼️ **PDF 智能封面提取**：内置 Python 预处理管道（基于 PyMuPDF），自动将 PDF 第一页高精渲染导出为封面 `.jpg`，彻底解决 PDF 缺乏封面的痛点。
- 🔍 **元数据自动提取与降级**：优先读取图书内置标签（Title/Author），缺失时自动通过正则表达式从文件名中洗净提取。
- ⚡ **极速加载体验**：采用构建时（Pre-build）生成静态 `books.json` 架构，前端零时延读取书架，告别运行时大文件解析卡顿。
- 🚀 **自动化 CI/CD**：部署全流程托管至 GitHub Actions，一键推送（`git push`）自动构建与发布上线。

---

## 📁 目录结构

```text
folio-library/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 自动构建与部署工作流
├── public/
│   ├── books/                  # [静态资源] 存放原始 .epub 和 .pdf 图书文件
│   ├── covers/                 # [自动生成] 预处理生成的图书封面图片
│   └── books.json              # [自动生成] 统一的图书元数据索引
├── src/                        # 前端源码 (Vite 前端应用)
├── build_library.py            # 图书预处理脚本（解析元数据并渲染 PDF 封面）
├── vite.config.js              # Vite 配置文件 (设置 base: '/folio-library/')
└── package.json

```

---

## 🛠️ 本地开发与使用指南

### 1. 环境准备

确保本地已安装 [Node.js](https://nodejs.org/) (v18+) 与 [Python](https://www.python.org/) (3.10+)。

安装 Python 预处理依赖：

```bash
pip install pymupdf

```

安装前端项目依赖：

```bash
npm install

```

### 2. 整理图书与构建数据

1. 将你的 `.epub` 或 `.pdf` 文件放入 `public/books/` 目录下。
2. 运行预处理脚本生成封面图与 `books.json`：
```bash
python build_library.py

```



### 3. 本地运行调试

启动前端本地开发服务器：

```bash
npm run dev

```

打开控制台输出的本地链接（如 `http://localhost:5173/folio-library/`）即可实时预览书架。

---

## 🚀 发布到 GitHub Pages

推送代码到 GitHub 仓库的 `main` 分支即可自动触发构建与部署：

```powershell
git add .
git commit -m "feat: add new books and update library metadata"
git push origin main

```

构建完成后，在仓库 **Actions** 页面可查看部署状态，几秒后刷新在线站点即可看到最新书架。

---

## 📄 开源许可

本项目基于 [MIT License](https://www.google.com/search?q=LICENSE) 开源。
