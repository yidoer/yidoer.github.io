# 本次改动逐文件说明

对应提交 `ceef65b`（主要改动）与 `41a28cd`（编辑入口调整），基线为 `origin/main`。

统计口径为 `git diff origin/main...HEAD --ignore-cr-at-eol`，已排除 Windows 行尾归一化造成的假改动。总计 **50 个文件，+1859 / −475 行**；下表按类型分组，行数为真实内容差异。

---

## 一、新增：订阅源与生成脚本

| 文件 | 行数 | 说明 |
|---|---|---|
| `feed.xml` | +57 | 全部内容 RSS 2.0，4 条（1 文章 + 3 小记），正文用 `<content:encoded>` CDATA |
| `feed-notes.xml` | +43 | 仅小记的 RSS 2.0，3 条 |
| `feed-atom.xml` | +25 | 仅文章的 Atom 1.0，1 条 |
| `scripts/generate-feed.js` | +230 | 生成上面三份订阅源；正文调用 `js/markdown.js` 渲染，图片与站内链接转绝对地址；日期锚定 `T12:00:00Z` 避免时区漂移 |
| `scripts/check-feeds.js` | +219 | 零依赖校验器：XML 良构、RSS/Atom 必填字段、绝对地址、`pubDate` 可解析、**严格倒序**。CI 中运行，失败即中止部署 |
| `scripts/generate-sitemap.js` | +57 | 生成 `sitemap.xml`，共 11 个 URL（含 3 个订阅源） |
| `sitemap.xml` | +69 | 上一条的产物 |
| `robots.txt` | +13 | 放行全站、声明 Sitemap，并注释说明三个订阅源 |

## 二、Markdown 解析器抽成共享模块

| 文件 | 行数 | 说明 |
|---|---|---|
| `js/markdown.js` | +220 / −0 | **新增**。UMD 包装，浏览器挂 `window.Markdown`、Node 走 `module.exports`。网页渲染与订阅源正文从此共用同一份实现 |
| `js/app.js` | +56 / −218 | **移出**约 196 行内联 `Markdown` 对象；**新增** 5 个抽出复用的方法：`escapeHtml`、`emptyStateHtml`、`articleCardHtml`、`noteCardHtml`、`renderPagination`。同时删除整段从未生效的 `initMobileMenu()` |
| `js/article-page.js` | +1 / −1 | `navigation.style.display='flex'` 改为 `navigation.hidden=false`，否则会被 `[hidden]{display:none!important}` 压住 |
| `editor.html` | +1 / −2 | 引入 `js/markdown.js`（必须在 `app.js` 之前）；移除失效的汉堡按钮、移除页脚「手机发布」 |
| `mobile-editor.html` | +6 / −0 | 引入 `js/markdown.js`；弹窗正文区加 `overflow-y:auto` 滚动 |
| `js/mobile-editor.js` | +10 / −6 | 主题切换原读 `localStorage['theme']`，与公开页的 `blog-theme` 键不一致，改为就地实现并对齐键名，同时补 `if (!toggle) return` 防空 |

## 三、页面与模板

| 文件 | 行数 | 说明 |
|---|---|---|
| `articles.html` | +55 / −94 | 加 canonical、feed 自动发现、og 标签；行内 `style` 抽成语义类 `.page-intro`；`style="display:none"` 改为 `hidden` 属性；删汉堡按钮；卡片渲染改用公共方法 |
| `notes.html` | +28 / −52 | 同上 |
| `index.html` | +25 / −38 | 同上；页脚移除「编辑」 |
| `about.html` | +27 / −18 | 顶部按钮「编辑后台 / 手机发布」→「RSS 订阅 / 小记 RSS」；页脚新增 `.footer-tools` 一行放编辑入口；补 canonical/og/feed |
| `article.html` | +26 / −7 | 旧跳转页重写：增加失败态提示与 `noindex`，去掉未使用的 pet 资源引用 |
| `404.html` | +10 / −14 | 行内样式抽成 `.error-page` 等类；补 `noindex` 与 description；删汉堡按钮 |
| `scripts/article-template.html` | +14 / −4 | 加 feed 自动发现、og/Twitter 卡片、`article:published_time`、页脚 RSS |
| `scripts/note-template.html` | +13 / −3 | 同上 |
| `scripts/generate-articles.js` | +1 / −0 | `.replaceAll('__DATE__', …)`，把日期真正写进模板 |

## 四、样式

| 文件 | 行数 | 说明 |
|---|---|---|
| `css/style.css` | +53 / −2 | 新增 `[hidden]{display:none!important}`、`.page-intro`、`.info-panel*`、`.error-*`、`.footer-tools` 系列及编辑器若干类；**删除**两处 `.menu-toggle` 规则（base 与 768px 媒体查询各一处，原本都是 `display:none`） |

## 五、本地开发与工具脚本（均为新增）

| 文件 | 行数 | 说明 |
|---|---|---|
| `scripts/serve.js` | +50 | 本地静态预览服务器（`node scripts/serve.js 8899`），绑定 127.0.0.1，带 MIME 表与路径穿越防护 |
| `scripts/check-pages.js` | +82 | Playwright 扫 9 个页面，收集 console/pageerror/请求失败，并检查 `<p>` 内是否错套 `ul/ol/blockquote/table` |
| `scripts/validate-data.js` | +94 | 校验 `data/*.json` 结构与字段，CI 首步执行 |
| `scripts/optimize-avatar.ps1` | +65 | 头像压图脚本；从内存流读入避免文件锁，先 `Remove-Item` 再 `Move-Item` |

## 六、发布流程

| 文件 | 行数 | 说明 |
|---|---|---|
| `.github/workflows/pages.yml` | +8 / −0 | 顺序改为：数据校验 → 生成页面/sitemap/订阅源 → 订阅源校验 → 上传 → 部署。任一步失败即中止 |
| `scripts/publish.ps1` | +8 / −1 | 接入 `validate-data.js`（失败即抛错中止）、`generate-sitemap.js`、`generate-feed.js` |

## 七、仓库配置（均为新增）

| 文件 | 行数 | 说明 |
|---|---|---|
| `.gitattributes` | +23 | `* text=auto eol=lf`，`.ps1` 用 CRLF，图片标记 `binary`。解决 Windows 下整文件 diff 噪音 |
| `.gitignore` | +24 | 忽略 IDE、系统文件、预览产物、临时文件，以及 `null/`、`PowerShell 7.6.6/` 这类工具误建目录 |

## 八、文档

| 文件 | 行数 | 说明 |
|---|---|---|
| `PUBLISHING.md` | +44 / −2 | 新增「订阅源」表格与「手动重新生成」5 步流程；补数据校验与自检脚本说明；标注编辑入口统一在关于页页脚 |
| `images/README.md` | +28 / −2 | 重写：目录结构表、Markdown 图片路径用前导 `/` 的说明、重复上传检测片段。原内容引用了不存在的 `images/photo.jpg` |

## 九、二进制

| 文件 | 变化 | 说明 |
|---|---|---|
| `images/touxiang.jpg` | 321,242 B → 59,256 B | 1767×2000 → 480×543。全站最大显示 120px，3x 屏下仍有余量 |
| `images/uploads/` 下 11 个 jpg | 删除 36.7 MB | 经逐个 SHA256 校验，与保留的 2 张**字节完全相同**，无独有内容丢失。`images/uploads/` 由 43.1 MB 降至 6.3 MB |

## 十、生成产物（随生成脚本自动更新）

| 文件 | 行数 | 说明 |
|---|---|---|
| `articles/26/09/article-01/index.html` | +77 / −0 | 文章详情页（新增） |
| `notes/26/07/note-01/index.html` | +13 / −4 | 小记详情页 |
| `notes/26/07/note-02/index.html` | +44 / −6 | 小记详情页 |
| `notes/26/10/note-01/index.html` | +39 / −0 | 小记详情页（新增） |

---

## 一个容易忽略的连带影响

`scripts/publish.ps1` 里删掉了 `Copy-Item … articles.json` 这一行（就是 `+8 / −1` 里的那 1 行删除）。该行原本把 `data/articles.json` 复制一份到仓库根目录，但根目录那份**没有被任何页面或脚本读取**，属于历史遗留。删除后根 `articles.json` 文件本身仍保留在仓库中，未被删除。

## 三个顺带修掉的既有 bug

都在 `js/markdown.js` 内，且已用重构前的原始代码做逐字节对比，确认是本次改动之前就存在的：

1. **引用块从未生效** —— `>` 在引用检测之前就被转义成 `&gt;`
2. **非法 HTML 嵌套** —— `</ul>`、`</h1>` 等闭合标签被包成 `<p></ul></p>`
3. **表格丢行** —— 末尾没有换行的表格会丢掉全部数据行，`<tbody>` 为空

第 2 条影响所有用列表排版的文章，属于实际渲染损坏。
