param(
    [string]$AndroidSdkRoot = 'C:\Android\Sdk',
    [string]$JavaBin = 'C:\Program Files\Java\jdk-23\bin'
)

$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $mobileRoot 'android'
$settingsPath = Join-Path $mobileRoot 'signing\keystore.properties'
$settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-StringData
$keyPath = (Resolve-Path -LiteralPath (Join-Path $androidRoot $settings.storeFile)).Path
$apkPath = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
$aabPath = Join-Path $androidRoot 'app\build\outputs\bundle\release\app-release.aab'
$buildTools = Join-Path $AndroidSdkRoot 'build-tools\36.0.0'
$expectedCertificate = '8808907bd72631b4ea4ae3ec592a46511fa3620f784c15796e32bbb38b387a69'

# Re-sign only already compiled artifacts. This script does not compile source.
# Keep input copies so a failure never removes the last completed APK/AAB.
$workPath = Join-Path $androidRoot ('app\build\outputs\signing\' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workPath | Out-Null
$inputApk = Join-Path $workPath 'input.apk'
$inputAab = Join-Path $workPath 'input.aab'
$signedApk = Join-Path $workPath 'app-release.apk'
$unsignedAab = Join-Path $workPath 'unsigned.aab'
$signedAab = Join-Path $workPath 'app-release.aab'
Copy-Item -LiteralPath $apkPath -Destination $inputApk
Copy-Item -LiteralPath $aabPath -Destination $inputAab
Copy-Item -LiteralPath $inputAab -Destination $unsignedAab

Add-Type -AssemblyName System.IO.Compression.FileSystem
function Test-SignatureEntry([string]$Name) {
    return $Name -match '^META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC)|SIG-[^/]+)$'
}

function Get-PayloadHashes([string]$Path) {
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    $hasher = [Security.Cryptography.SHA256]::Create()
    # ZIP paths are case-sensitive, including Android's shortened resource names.
    $hashes = [Collections.Hashtable]::new([StringComparer]::Ordinal)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/') -or (Test-SignatureEntry $entry.FullName)) { continue }
            if ($hashes.ContainsKey($entry.FullName)) { throw "Duplicate ZIP entry: $($entry.FullName)" }
            $stream = $entry.Open()
            try { $hashes[$entry.FullName] = [BitConverter]::ToString($hasher.ComputeHash($stream)) }
            finally { $stream.Dispose() }
        }
    } finally { $hasher.Dispose(); $archive.Dispose() }
    return $hashes
}

function Assert-SamePayload([string]$Before, [string]$After) {
    $beforeHashes = Get-PayloadHashes $Before
    $afterHashes = Get-PayloadHashes $After
    if ($beforeHashes.Count -ne $afterHashes.Count) { throw 'Signing changed the ZIP payload entry count.' }
    foreach ($name in $beforeHashes.Keys) {
        if ($beforeHashes[$name] -ne $afterHashes[$name]) { throw "Signing changed application payload: $name" }
    }
}

# Remove only old JAR signature metadata from the generated AAB working copy.
$archive = [IO.Compression.ZipFile]::Open($unsignedAab, [IO.Compression.ZipArchiveMode]::Update)
try {
    $oldSignatures = @($archive.Entries | Where-Object { Test-SignatureEntry $_.FullName })
    foreach ($entry in $oldSignatures) { $entry.Delete() }
} finally { $archive.Dispose() }

$previousStorePassword = $env:FLYMADD_UPLOAD_STORE_PASSWORD
$previousKeyPassword = $env:FLYMADD_UPLOAD_KEY_PASSWORD
try {
    # Pass secrets through child-process environment, never command arguments.
    $env:FLYMADD_UPLOAD_STORE_PASSWORD = $settings.storePassword
    $env:FLYMADD_UPLOAD_KEY_PASSWORD = $settings.keyPassword
    & (Join-Path $buildTools 'apksigner.bat') sign --ks $keyPath --ks-key-alias $settings.keyAlias --ks-pass env:FLYMADD_UPLOAD_STORE_PASSWORD --key-pass env:FLYMADD_UPLOAD_KEY_PASSWORD --out $signedApk $inputApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    & (Join-Path $JavaBin 'jarsigner.exe') -keystore $keyPath -storepass:env FLYMADD_UPLOAD_STORE_PASSWORD -keypass:env FLYMADD_UPLOAD_KEY_PASSWORD -sigalg SHA256withRSA -digestalg SHA-256 -signedjar $signedAab $unsignedAab $settings.keyAlias
    if ($LASTEXITCODE -ne 0) { throw 'AAB signing failed.' }

    $apkVerification = & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $signedApk 2>&1
    if ($LASTEXITCODE -ne 0 -or ($apkVerification -join "`n") -notmatch $expectedCertificate) { throw 'APK certificate or signature verification failed.' }
    $alignment = & (Join-Path $buildTools 'zipalign.exe') -c -P 16 4 $signedApk 2>&1
    if ($LASTEXITCODE -ne 0) { throw "APK alignment verification failed: $alignment" }
    $aabVerification = & (Join-Path $JavaBin 'jarsigner.exe') -verify -keystore $keyPath -storepass:env FLYMADD_UPLOAD_STORE_PASSWORD $signedAab 2>&1
    if ($LASTEXITCODE -ne 0 -or ($aabVerification -join "`n") -notmatch 'jar verified\.' -or ($aabVerification -join "`n") -match 'unsigned entries') { throw "AAB verification failed: $aabVerification" }
    $aabCertificate = & (Join-Path $JavaBin 'keytool.exe') -printcert -jarfile $signedAab 2>&1
    if ($LASTEXITCODE -ne 0 -or (($aabCertificate -join "`n") -replace ':', '').ToLowerInvariant() -notmatch $expectedCertificate) { throw 'AAB certificate does not match the original release key.' }

    Assert-SamePayload $inputApk $signedApk
    Assert-SamePayload $inputAab $signedAab
    Copy-Item -LiteralPath $signedApk -Destination $apkPath -Force
    Copy-Item -LiteralPath $signedAab -Destination $aabPath -Force
    Write-Output 'Verified: original FlyMadd certificate, APK alignment, AAB signature, and identical application payloads.'
    foreach ($artifactPath in @($apkPath, $aabPath)) {
        $artifact = Get-Item -LiteralPath $artifactPath
        [pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;SHA256=(Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash} | ConvertTo-Json -Compress
    }
    Write-Output "Previous artifact copies: $workPath"
} finally {
    $env:FLYMADD_UPLOAD_STORE_PASSWORD = $previousStorePassword
    $env:FLYMADD_UPLOAD_KEY_PASSWORD = $previousKeyPassword
}
