# Reproducible export of the NickNotes app icon (note sheet with a stroked N); Windows/.NET only.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repoRoot 'build'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$inkHex = '#111111'; $mutedHex = '#9a9a9a'
$sheet = @(48,24, 158,24, 208,74, 208,232, 48,232)
$fold = @(158,34, 158,74, 202,74)
$letter = @(92,194, 92,120, 164,194, 164,120)
$hint = @(92,72, 126,72)
$strokeWidth = 14; $letterWidth = 22; $hintWidth = 10; $radius = 30; $foldRadius = 10

# Rounded polygon corners (quadratic curves); returns SVG path data and the same shape as GraphicsPath.
function Get-RoundedShape([double[]]$c, [double]$r, [bool]$closed) {
  $n = $c.Count / 2
  $pts = 0..($n - 1) | ForEach-Object { [pscustomobject]@{X = $c[2*$_]; Y = $c[2*$_ + 1]} }
  $path = [Drawing.Drawing2D.GraphicsPath]::new(); $d = ''
  $cursor = $null
  for ($k = 0; $k -le $n; $k++) {
    $i = $k % $n
    $isEnd = (-not $closed) -and ($i -eq 0 -or $i -eq $n - 1)
    $cur = $pts[$i]
    if ($isEnd -and $k -lt $n) { $point = $cur; if ($k -eq 0) { $cursor = $point; $d += "M$($point.X) $($point.Y)"; continue } }
    if ($isEnd) { $path.AddLine([single]$cursor.X,[single]$cursor.Y,[single]$cur.X,[single]$cur.Y); $d += "L$($cur.X) $($cur.Y)"; break }
    $prev = $pts[($i + $n - 1) % $n]; $next = $pts[($i + 1) % $n]
    $lp = [math]::Sqrt([math]::Pow($prev.X-$cur.X,2)+[math]::Pow($prev.Y-$cur.Y,2))
    $ln = [math]::Sqrt([math]::Pow($next.X-$cur.X,2)+[math]::Pow($next.Y-$cur.Y,2))
    $t = [math]::Min($r, [math]::Min($lp, $ln) / 2)
    $a = [pscustomobject]@{X = $cur.X + ($prev.X-$cur.X)/$lp*$t; Y = $cur.Y + ($prev.Y-$cur.Y)/$lp*$t}
    $b = [pscustomobject]@{X = $cur.X + ($next.X-$cur.X)/$ln*$t; Y = $cur.Y + ($next.Y-$cur.Y)/$ln*$t}
    if ($null -eq $cursor) { $cursor = $b; $d += "M$([math]::Round($b.X,2)) $([math]::Round($b.Y,2))"; continue }
    $path.AddLine([single]$cursor.X,[single]$cursor.Y,[single]$a.X,[single]$a.Y)
    $c1 = [Drawing.PointF]::new([single]($a.X + 2/3*($cur.X-$a.X)), [single]($a.Y + 2/3*($cur.Y-$a.Y)))
    $c2 = [Drawing.PointF]::new([single]($b.X + 2/3*($cur.X-$b.X)), [single]($b.Y + 2/3*($cur.Y-$b.Y)))
    $path.AddBezier([Drawing.PointF]::new([single]$a.X,[single]$a.Y), $c1, $c2, [Drawing.PointF]::new([single]$b.X,[single]$b.Y))
    $d += "L$([math]::Round($a.X,2)) $([math]::Round($a.Y,2))Q$($cur.X) $($cur.Y) $([math]::Round($b.X,2)) $([math]::Round($b.Y,2))"
    $cursor = $b
  }
  if ($closed) { $path.CloseFigure(); $d += 'Z' }
  [pscustomobject]@{Path = $path; D = $d}
}

$sheetShape = Get-RoundedShape $sheet $radius $true
$foldShape = Get-RoundedShape $fold $foldRadius $false
$letterShape = Get-RoundedShape $letter 0 $false
$hintShape = Get-RoundedShape $hint 0 $false

$svg = "<svg xmlns=`"http://www.w3.org/2000/svg`" viewBox=`"0 0 256 256`"><path d=`"$($sheetShape.D)`" fill=`"#fff`" stroke=`"$inkHex`" stroke-width=`"$strokeWidth`" stroke-linejoin=`"round`"/><path d=`"$($foldShape.D)`" fill=`"none`" stroke=`"$inkHex`" stroke-width=`"$strokeWidth`" stroke-linecap=`"round`" stroke-linejoin=`"round`"/><path d=`"$($letterShape.D)`" fill=`"none`" stroke=`"$inkHex`" stroke-width=`"$letterWidth`" stroke-linecap=`"round`" stroke-linejoin=`"round`"/><path d=`"$($hintShape.D)`" fill=`"none`" stroke=`"$mutedHex`" stroke-width=`"$hintWidth`" stroke-linecap=`"round`"/></svg>"
[IO.File]::WriteAllText((Join-Path $outputDirectory 'icon.svg'), $svg)
[IO.File]::WriteAllText((Join-Path $repoRoot 'src/frontend/public/favicon.svg'), $svg)

function New-Pen($hex, $width, $cap) {
  $pen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml($hex), $width)
  $pen.StartCap = $pen.EndCap = $cap; $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
  $pen
}

$images = @()
foreach ($size in @(16,32,48,64,128,256)) {
  $bitmap = [Drawing.Bitmap]::new($size,$size)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size/256.0,$size/256.0)
  $round = [Drawing.Drawing2D.LineCap]::Round
  $pens = @((New-Pen $inkHex $strokeWidth $round), (New-Pen $inkHex $letterWidth $round), (New-Pen $mutedHex $hintWidth $round))
  $graphics.FillPath([Drawing.Brushes]::White, $sheetShape.Path)
  $graphics.DrawPath($pens[0], $sheetShape.Path)
  $graphics.DrawPath($pens[0], $foldShape.Path)
  $graphics.DrawPath($pens[1], $letterShape.Path)
  $graphics.DrawPath($pens[2], $hintShape.Path)
  $memory = [IO.MemoryStream]::new()
  $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
  $images += ,@($size,$memory.ToArray())
  if ($size -eq 256) { [IO.File]::WriteAllBytes((Join-Path $outputDirectory 'icon.png'),$memory.ToArray()) }
  $memory.Dispose(); $pens | ForEach-Object { $_.Dispose() }; $graphics.Dispose(); $bitmap.Dispose()
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
