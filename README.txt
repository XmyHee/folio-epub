请把下面文件放到仓库根目录（覆盖已有文件）：

  package-lock.json          ← 新建（解决 cache: npm 报错）
  package.json               ← 覆盖
  .github/workflows/pages.yml ← 覆盖

然后 git add -A && git commit -m "Fix deploy: add package-lock" && git push

不要只改 pipeline 而覆盖掉 pages.yml。
