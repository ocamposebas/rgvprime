$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgv-edebit-guard'))
$outputPath = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgv-edebit-guard-1.0.0.zip'))

if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    throw "eDebit Guard plugin source directory was not found: $pluginRoot"
}

if ([IO.Path]::GetDirectoryName($outputPath) -ne [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin'))) {
    throw 'ZIP output path escaped the wordpress-plugin directory.'
}

$fileStream = [IO.File]::Open($outputPath, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false)

try {
    Get-ChildItem -LiteralPath $pluginRoot -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($pluginRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        $entry = $archive.CreateEntry("rgv-edebit-guard/$relativePath", [IO.Compression.CompressionLevel]::Optimal)
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

