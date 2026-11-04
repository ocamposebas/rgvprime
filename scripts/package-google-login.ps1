$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$sourcePath = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgv-google-login'))
$outputPath = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgv-google-login-1.0.0.zip'))

if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    throw "Plugin source directory was not found: $sourcePath"
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Force
}

$fileStream = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew)
$archive = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false)

try {
    Get-ChildItem -LiteralPath $sourcePath -File -Recurse | ForEach-Object {
        $relativePath = [IO.Path]::GetRelativePath($sourcePath, $_.FullName).Replace('\', '/')
        $entry = $archive.CreateEntry("rgv-google-login/$relativePath", [IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $inputStream = [IO.File]::OpenRead($_.FullName)

        try {
            $inputStream.CopyTo($entryStream)
        }
        finally {
            $inputStream.Dispose()
            $entryStream.Dispose()
        }
    }
}
finally {
    $archive.Dispose()
    $fileStream.Dispose()
}

Write-Output $outputPath
