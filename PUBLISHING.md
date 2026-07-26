# 发文说明

## 推荐方式：命令发布

文章正文可先写在 Markdown 文件中，然后运行：

```powershell
.\scripts\publish.ps1 -Type article -Title "文章标题" -File ".\draft.md" -Category "随笔" -Tags 思考,生活
```

发布一条小记：

```powershell
.\scripts\publish.ps1 -Type note -Content "今天想记录的内容"
```

脚本会自动：

- 更新 `data/articles.json` 或 `data/notes.json`
- 生成独立永久链接
- 生成文章或小记详情页
- 为详情页接入按路径区分的评论

完成后提交并推送到 GitHub，Pages 工作流会重新生成页面并发布。

## 网页编辑器

也可以打开 `editor.html`，在“导出/导入”页点击“选择博客根目录”，选择包含 `data/`、`images/` 的项目目录。推荐使用最新版 Chrome 或 Edge。

连接后：

- 上传图片会直接保存到 `images/uploads/年/月/日/`，正文只记录图片路径，不再保存 Base64
- 保存文章或小记时会自动覆盖 `data/articles.json` 和 `data/notes.json`
- 已有的 Base64 图片会在“立即写入项目”时自动迁移到 `images/`
- 不需要再导出、复制或粘贴 JSON；完成后直接用 Git 提交并推送

如果浏览器不支持目录写入，仍可使用备用下载功能，将导出的完整 JSON 文件覆盖到 `data/` 目录。

### 手机发布

手机访问线上 `editor.html` 后，可以正常新建文章、小记，并从相册上传图片。图片会暂存在手机浏览器的 IndexedDB 中，不会转成 Base64 写进正文。

发布步骤：

1. 在“导出/导入”页创建 GitHub Fine-grained Token，仓库选择 `yidoer/yidoer.github.io`，权限只需要 `Contents: Read and write`。
2. 在手机编辑文章或小记，上传图片并保存。
3. 在“导出/导入”页输入 Token，点击“发布到 GitHub”。
4. 发布成功后 Token 会被清空，GitHub Pages 工作流会自动部署。

手机端不会写入电脑本地目录，而是通过 GitHub API 一次提交 JSON 和图片。请不要在公共设备上使用 Token；Token 建议设置短有效期，发布后可以在 GitHub 设置中撤销。

## 评论

评论使用 Utterances。正文或小记内容渲染完成后，页面才开始加载评论脚本。仓库需安装 Utterances App，并开启 GitHub Issues。

> 注意：替换 JSON 时必须覆盖整个文件。不要只复制 `"articles": [...]` 这一段追加到旧文件，否则 GitHub Actions 无法解析 JSON。

## 访问统计

公共页面通过 `js/app.js` 异步加载 21SDK 官方快速集成脚本。脚本使用公开的网站标识，不在前端保存 API Key；桌面编辑器和手机编辑器不会上报，官方脚本也只接受 `yidoer.github.io` 域名的访问。
