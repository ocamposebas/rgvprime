$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgvprime-edebit-order-endpoint'))
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin'))
$outputPath = [IO.Path]::GetFullPath((Join-Path $outputDirectory 'rgvprime-edebit-order-endpoint-1.2.2.zip'))

if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    throw "RGVPRIME eDebit order endpoint source directory was not found: $pluginRoot"
}

if ([IO.Path]::GetDirectoryName($outputPath) -ne $outputDirectory) {
    throw 'ZIP output path escaped the wordpress-plugin directory.'
}

$fileStream = [IO.File]::Open($outputPath, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new(
    $fileStream,
    [IO.Compression.ZipArchiveMode]::Create,
    $false
)

try {
    Get-ChildItem -LiteralPath $pluginRoot -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($pluginRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        $entry = $archive.CreateEntry(
            "rgvprime-edebit-order-endpoint/$relativePath",
            [IO.Compression.CompressionLevel]::Optimal
        )
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
    $invalidEntry = $validationArchive.Entries |
        Where-Object { $_.FullName.Contains('\') } |
        Select-Object -First 1

    if ($invalidEntry) {
        throw "ZIP contains an invalid backslash path: $($invalidEntry.FullName)"
    }
} finally {
    $validationArchive.Dispose()
}

Get-Item -LiteralPath $outputPath
