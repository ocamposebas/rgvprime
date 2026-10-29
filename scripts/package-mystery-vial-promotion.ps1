$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgv-mystery-vial-promotion'))
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin'))
$outputPath = [IO.Path]::GetFullPath((Join-Path $outputDirectory 'rgv-mystery-vial-promotion-1.0.0.zip'))

if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    throw "Mystery Vial promotion plugin source directory was not found: $pluginRoot"
}

if ([IO.Path]::GetDirectoryName($outputPath) -ne $outputDirectory) {
    throw 'ZIP output path escaped wordpress-plugin.'
}

$fileStream = [IO.File]::Open($outputPath, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false)

try {
    Get-ChildItem -LiteralPath $pluginRoot -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($pluginRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        $entry = $archive.CreateEntry("rgv-mystery-vial-promotion/$relativePath", [IO.Compression.CompressionLevel]::Optimal)
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

$validationArchive = [IO.Compression.ZipFile]::OpenRead($outputPath)

try {
    $invalidEntry = $validationArchive.Entries | Where-Object { $_.FullName.Contains('\') } | Select-Object -First 1
    if ($invalidEntry) {
        throw "ZIP contains an invalid backslash path: $($invalidEntry.FullName)"
    }
} finally {
    $validationArchive.Dispose()
}

Get-Item -LiteralPath $outputPath

