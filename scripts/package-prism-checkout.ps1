$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin\rgv-prism-checkout'))
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $workspace 'wordpress-plugin'))
$outputPath = [IO.Path]::GetFullPath((Join-Path $outputDirectory 'rgv-prism-checkout-3.8.0.zip'))

if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    throw "Card and wallet return source directory was not found: $pluginRoot"
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
    Get-ChildItem -LiteralPath $pluginRoot -Recurse -File |
        Where-Object { $_.Extension -ne '.lnk' } |
        ForEach-Object {
        $relativePath = $_.FullName.Substring($pluginRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        $entry = $archive.CreateEntry(
            "rgv-prism-checkout/$relativePath",
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
    $expectedEntry = 'rgv-prism-checkout/rgv-prism-checkout.php'
    $mainEntry = $validationArchive.GetEntry($expectedEntry)

    if (-not $mainEntry) {
        throw "ZIP is missing its main plugin entry: $expectedEntry"
    }

    $reader = [IO.StreamReader]::new($mainEntry.Open())
    try {
        $mainSource = $reader.ReadToEnd()
    } finally {
        $reader.Dispose()
    }

    if ($mainSource -notmatch 'Plugin Name:\s+RGV Storefront Card & Wallet Return' -or
        $mainSource -notmatch 'Version:\s+3\.8\.0') {
        throw 'ZIP main plugin header is not the expected 3.8.0 express-wallet build.'
    }

    foreach ($requiredEntry in @(
        'rgv-prism-checkout/templates/checkout/form-pay.php',
        'rgv-prism-checkout/assets/css/order-pay.css',
        'rgv-prism-checkout/assets/js/order-pay.js'
    )) {
        if (-not $validationArchive.GetEntry($requiredEntry)) {
            throw "ZIP is missing its storefront checkout asset: $requiredEntry"
        }
    }

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
