$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgv-card-wallet-stability'))
$outputPath = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgv-card-wallet-stability-1.4.0.zip'))
$pluginDirectory = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin'))

if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    throw "Card & Wallet stability plugin source directory was not found: $pluginRoot"
}

if ([IO.Path]::GetDirectoryName($outputPath) -ne $pluginDirectory) {
    throw 'ZIP output path escaped the wordpress-plugin directory.'
}

$fileStream = [IO.File]::Open($outputPath, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false)

try {
    Get-ChildItem -LiteralPath $pluginRoot -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($pluginRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        $entry = $archive.CreateEntry("rgv-card-wallet-stability/$relativePath", [IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $sourceStream = [IO.File]::OpenRead($_.FullName)

        try {
            $sourceStream.CopyTo($entryStream)
        } finally {
            $sourceStream.Dispose()
            $entryStream.Dispose()
        }
    }
} finally {
    $archive.Dispose()
    $fileStream.Dispose()
}

Get-Item -LiteralPath $outputPath
