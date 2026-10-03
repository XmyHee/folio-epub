# Folio

本地 EPUB 书库整理：审计内部元数据 → 规范命名 → 智能去重。全部在浏览器完成，文件不上传。

**线上地址（部署成功后）：** https://xmyhee.github.io/folio-epub/

## 当前仓库为何失败

1. 源码在子目录 `folio/`，不在仓库根目录  
2. GitHub Actions 只认仓库根的 `.github/workflows/`  
3. 自建的 `main.yml` 运行失败，且未配置正确的 Pages `base`

本包文件均在**仓库根目录**，并已配置 Pages 工作流。

## 覆盖推送到 GitHub（本机执行）

```bash
# 解压本包后进入目录
cd folio-epub-deploy

git init
git add .
git commit -m "Fix: root layout + GitHub Pages workflow"
git branch -M main
git remote add origin https://github.com/XmyHee/folio-epub.git
# 用 force 清掉错误的 folio/ 嵌套结构
git push -u origin main --force
```

然后：

1. 打开 https://github.com/XmyHee/folio-epub/settings/pages  
2. **Source** 选 **GitHub Actions**（不要选 Deploy from a branch）  
3. 打开 https://github.com/XmyHee/folio-epub/actions 等待绿色成功  
4. 访问 https://xmyhee.github.io/folio-epub/

## 本地开发

```bash
npm install
npm run dev
```

## 技术栈

React 19 + TypeScript + Vite · JSZip · Zustand
