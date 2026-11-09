param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('article', 'note')]
  [string]$Type,
  [string]$Title,
  [string]$Content,
  [string]$File,
  [string]$Date = (Get-Date -Format 'yyyy-MM-dd'),
  [string]$Category = '随笔',
  [string[]]$Tags = @()
)

$root = Split-Path -Parent $PSScriptRoot
if ($File) {
  $resolvedFile = Resolve-Path -LiteralPath $File -ErrorAction Stop
  $Content = Get-Content -LiteralPath $resolvedFile -Raw
}
if (-not $Content) { throw '请通过 -Content 或 -File 提供正文。' }

if ($Type -eq 'article') {
  if (-not $Title) { throw '发布文章时必须提供 -Title。' }
  $dataPath = Join-Path $root 'data\articles.json'
  $data = Get-Content -LiteralPath $dataPath -Raw | ConvertFrom-Json
  $id = 'article-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $slug = ($Title.ToLowerInvariant() -replace '[^a-z0-9\u4e00-\u9fff]+', '-').Trim('-')
  if (-not $slug) { $slug = $id }
  $article = [pscustomobject]@{
    id = $id
    path = "/articles/$($Date.Replace('-', '/'))/$slug/"
    title = $Title
    date = $Date
    category = $Category
    tags = @($Tags)
    excerpt = (($Content -replace '[#>*_`\r\n-]+', ' ').Trim() -split '\s+' | Select-Object -First 50) -join ' '
    content = $Content
  }
  $data.articles = @($data.articles) + $article
  $data | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $dataPath -Encoding utf8
  & node (Join-Path $root 'scripts\validate-data.js')
  if ($LASTEXITCODE -ne 0) { throw '数据校验失败，已中止发布。' }
  & node (Join-Path $root 'scripts\generate-articles.js')
  & node (Join-Path $root 'scripts\generate-sitemap.js')
  & node (Join-Path $root 'scripts\generate-feed.js')
  Write-Output "文章已生成：$($article.path)"
} else {
  $dataPath = Join-Path $root 'data\notes.json'
  $data = Get-Content -LiteralPath $dataPath -Raw | ConvertFrom-Json
  $id = 'note-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $note = [pscustomobject]@{
    id = $id
    path = "/notes/$($Date.Replace('-', '/'))/$id/"
    date = $Date
    content = $Content
  }
  $data.notes = @($data.notes) + $note
  $data | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $dataPath -Encoding utf8
  & node (Join-Path $root 'scripts\validate-data.js')
  if ($LASTEXITCODE -ne 0) { throw '数据校验失败，已中止发布。' }
  & node (Join-Path $root 'scripts\generate-notes.js')
  & node (Join-Path $root 'scripts\generate-sitemap.js')
  & node (Join-Path $root 'scripts\generate-feed.js')
  Write-Output "小记已生成：$($note.path)"
}
