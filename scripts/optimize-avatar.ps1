# 按比例缩小头像图片，保持宽高比并压到合理体积
# 用法：pwsh -NoProfile -File scripts/optimize-avatar.ps1 [-Width 480] [-Quality 88]
param(
  [int]$Width = 480,
  [int]$Quality = 88
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'images\touxiang.jpg'
if (-not (Test-Path $source)) { throw "找不到 $source" }

$before = (Get-Item $source).Length
# 从内存流加载，避免 FromFile 长期占用源文件导致后续无法替换
$bytes = [System.IO.File]::ReadAllBytes($source)
$stream = New-Object System.IO.MemoryStream(,$bytes)
$original = [System.Drawing.Image]::FromStream($stream)
try {
  $origW = $original.Width
  $origH = $original.Height

  if ($origW -le $Width) {
    Write-Output "原图宽度 $origW 不大于目标宽度 $Width，无需处理。"
    return
  }

  $newW = $Width
  $newH = [int][Math]::Round($origH * $Width / $origW)

  $bitmap = New-Object System.Drawing.Bitmap($newW, $newH)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($original, 0, 0, $newW, $newH)
  } finally {
    $graphics.Dispose()
  }

  # JPEG 编码器参数：设置质量
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

  $temp = Join-Path $root ('images\touxiang.optimized.' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.jpg')
  $bitmap.Save($temp, $codec, $encoderParams)
  $encoderParams.Dispose()
  $bitmap.Dispose()

  # Windows 上目标若被占用或已存在，先删再移
  if (Test-Path $source) { Remove-Item -LiteralPath $source -Force }
  Move-Item -LiteralPath $temp -Destination $source -Force
  $after = (Get-Item $source).Length

  Write-Output "原图: ${origW}x${origH}, $('{0:N0}' -f $before) B"
  Write-Output "新图: ${newW}x${newH}, $('{0:N0}' -f $after) B"
  Write-Output ("节省: {0:N0} B ({1:P1})" -f ($before - $after), (($before - $after) / $before))
} finally {
  $original.Dispose()
  $stream.Dispose()
}
