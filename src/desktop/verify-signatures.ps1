$ErrorActionPreference = 'Stop'
if (-not $env:NICKNOTES_EXPECTED_PUBLISHER) { throw 'Expected publisher is missing.' }
$files = @($env:NICKNOTES_SIGNED_FILES | ConvertFrom-Json)
if ($files.Count -eq 0) { throw 'No files provided for signature verification.' }
foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) { throw "Missing valid timestamped signature: $file" }
  $publisher = $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)
  if ($publisher -cne $env:NICKNOTES_EXPECTED_PUBLISHER) { throw "Unexpected publisher: $file" }
}
Write-Output 'Files have valid timestamped signatures from the expected publisher.'
