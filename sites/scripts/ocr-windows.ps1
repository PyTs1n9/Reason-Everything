param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($Task, [Type]$ResultType) {
  $method = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $method.Invoke($null, @($Task))
  try { $netTask.Wait(-1) | Out-Null } catch {
    $exception = $_.Exception
    $messages = @()
    while ($exception) {
      $messages += $exception.Message
      $exception = $exception.InnerException
    }
    throw ($messages -join ' | ')
  }
  return $netTask.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'NO_OCR_ENGINE' }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$regions = @()
foreach ($line in $result.Lines) {
  foreach ($word in $line.Words) {
    $rect = $word.BoundingRect
    $regions += [pscustomobject]@{
      text = $word.Text
      box = [pscustomobject]@{ left = $rect.X; top = $rect.Y; width = $rect.Width; height = $rect.Height }
    }
  }
}
[pscustomobject]@{
  text = $result.Text
  width = $decoder.PixelWidth
  height = $decoder.PixelHeight
  regions = $regions
} | ConvertTo-Json -Compress -Depth 6
