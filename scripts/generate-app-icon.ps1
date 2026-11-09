# Reproducible export of the NickNotes vector monogram; Windows/.NET only.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repoRoot 'build'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="48" fill="#244d71"/><path d="M64 192V64H96L160 152V64H192V192H160L96 104V192Z" fill="#fff"/><path d="M64 216H192" stroke="#80c8b6" stroke-width="10" stroke-linecap="round"/></svg>'
[IO.File]::WriteAllText((Join-Path $outputDirectory 'icon.svg'), $svg)
[IO.File]::WriteAllText((Join-Path $repoRoot 'src/frontend/public/favicon.svg'), $svg)
$images = @()
foreach ($size in @(16,32,48,64,128,256)) {
  $bitmap = [Drawing.Bitmap]::new($size,$size)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size/256.0,$size/256.0)
  $background = [Drawing.Drawing2D.GraphicsPath]::new()
  foreach ($arc in @(@(8,8,96,96,180),@(152,8,96,96,270),@(152,152,96,96,0),@(8,152,96,96,90))) {
    $background.AddArc([single]$arc[0],[single]$arc[1],[single]$arc[2],[single]$arc[3],[single]$arc[4],90)
  }
  $background.CloseFigure()
  $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#244d71'))
  $graphics.FillPath($brush,$background)
  $points = [Drawing.PointF[]]@([Drawing.PointF]::new(64,192),[Drawing.PointF]::new(64,64),[Drawing.PointF]::new(96,64),[Drawing.PointF]::new(160,152),[Drawing.PointF]::new(160,64),[Drawing.PointF]::new(192,64),[Drawing.PointF]::new(192,192),[Drawing.PointF]::new(160,192),[Drawing.PointF]::new(96,104),[Drawing.PointF]::new(96,192))
  $graphics.FillPolygon([Drawing.Brushes]::White,$points)
  $pen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#80c8b6'),10)
  $pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($pen,64,216,192,216)
  $memory = [IO.MemoryStream]::new()
  $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
  $images += ,@($size,$memory.ToArray())
  if ($size -eq 256) { [IO.File]::WriteAllBytes((Join-Path $outputDirectory 'icon.png'),$memory.ToArray()) }
  $memory.Dispose(); $pen.Dispose(); $brush.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$stream = [IO.File]::Create((Join-Path $outputDirectory 'icon.ico'))
$writer = [IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
$offset = 6 + 16*$images.Count
foreach ($entry in $images) {
  $dimension = if ($entry[0] -eq 256) { 0 } else { $entry[0] }
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$entry[1].Length); $writer.Write([uint32]$offset)
  $offset += $entry[1].Length
}
foreach ($entry in $images) { $writer.Write([byte[]]$entry[1]) }
$writer.Dispose()
