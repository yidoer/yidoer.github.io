# 图片目录

站点的图片资源都放在这里。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| `images/touxiang.jpg` | 站点头像（导航栏与文章页复用） |
| `images/uploads/年/月/日/` | 编辑器上传的文章配图，按上传日期自动分目录 |
| `images/pet/` | 桌面宠物「毛绒蟹」的精灵图 |

## 在正文里引用

Markdown 中直接写站内绝对路径，这样详情页（`/articles/...`、`/notes/...`）和 RSS 订阅源都能正确显示：

```markdown
![图片描述](/images/uploads/2026/07/22/example.jpg)
```

注意开头的 `/`。省略它会变成相对于详情页目录的路径，导致图片 404，订阅器里也会跟着失效。

## 关于编辑器上传

用 `editor.html` 或手机编辑器上传图片时，文件会自动存到 `images/uploads/年/月/日/`，正文里只记录路径，不保存 Base64。同一次上传如果重复执行，可能产生内容相同但文件名不同的副本，可以用下面的命令检查重复：

```powershell
Get-ChildItem -Recurse -File images/uploads |
  Get-FileHash -Algorithm SHA256 |
  Group-Object Hash |
  Where-Object Count -gt 1 |
  ForEach-Object { $_.Group.Path }
```
