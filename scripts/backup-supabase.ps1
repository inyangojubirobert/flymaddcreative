<#
.SYNOPSIS
  Read-only pg_dump backup of the One Dream Supabase database, with verification.

.DESCRIPTION
  Credentials come from the SUPABASE_DB_URL environment variable
  (postgresql://USER:PASSWORD@HOST:PORT/DB) or a secure interactive prompt.
  The password is never printed, logged or written to disk; it is passed to pg_dump
  only through the PGPASSWORD variable of this process.
  Only reads from the database. Nothing is restored, migrated or modified.
#>
[CmdletBinding()]
param(
  [string]$BackupDir = 'D:\OneDream\Backups'
)

$ErrorActionPreference = 'Stop'

function Fail($message) {
  Write-Host ''
  Write-Host "BACKUP STATUS: FAILED" -ForegroundColor Red
  Write-Host $message -ForegroundColor Red
  exit 1
}

# 1. Tools
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
if (-not $pgDump -or -not $pgRestore) {
  $found = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace '\D', '') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { Test-Path (Join-Path $_ 'pg_dump.exe') } | Select-Object -First 1
  if ($found) {
    $env:PATH = "$found;$env:PATH"
    $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
    $pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
  }
}
if (-not $pgDump -or -not $pgRestore) {
  Write-Host 'BACKUP STATUS: BLOCKED - pg_dump / pg_restore not found.' -ForegroundColor Yellow
  Write-Host 'Install the PostgreSQL client tools (version 17 or newer, to match Supabase):'
  Write-Host '  winget install PostgreSQL.PostgreSQL.17   (choose "Command Line Tools" only)'
  Write-Host '  or download from https://www.postgresql.org/download/windows/'
  Write-Host 'Then open a new PowerShell window and run this script again.'
  exit 2
}

# 2. Connection details (never printed)
$dbUrl = $env:SUPABASE_DB_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  $secure = Read-Host 'Paste Supabase connection string (input hidden)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $dbUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if ($dbUrl -notmatch '^postgres(ql)?://([^:@/]+):(.+)@([^:@/]+):(\d+)/([^?]+)') {
  Fail 'Connection string must look like postgresql://USER:PASSWORD@HOST:PORT/DATABASE (use the Session pooler string from Supabase > Connect).'
}
$dbUser = [Uri]::UnescapeDataString($Matches[2])
$dbPass = [Uri]::UnescapeDataString($Matches[3])
$dbHost = $Matches[4]
$dbPort = $Matches[5]
$dbName = $Matches[6]
$dbUrl = $null

# 3. Output location (must be outside the repository)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ((Resolve-Path -LiteralPath (Split-Path $BackupDir -Qualifier) -ErrorAction SilentlyContinue) -eq $null) {
  Fail "Drive for $BackupDir does not exist."
}
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$resolvedDir = (Resolve-Path $BackupDir).Path
if ($resolvedDir.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  Fail 'Backup directory must be outside the project repository.'
}
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$file = Join-Path $resolvedDir "onedream-supabase-$timestamp.dump"

# 4. Export (read-only; custom format; schema + data; owners/privileges kept; RLS policies and triggers included)
$env:PGPASSWORD = $dbPass
$env:PGSSLMODE = 'require'
$dbPass = $null
try {
  Write-Host "Backing up $dbName on $dbHost as $dbUser ..."
  $ErrorActionPreference = 'Continue'
  & pg_dump --host $dbHost --port $dbPort --username $dbUser --dbname $dbName `
    --format=custom --compress=6 --no-password --verbose --file $file 2> "$file.log"
  if ($LASTEXITCODE -ne 0) {
    $tail = (Get-Content "$file.log" -Tail 8 | Where-Object { $_ -notmatch 'password' }) -join "`n"
    Remove-Item $file -ErrorAction SilentlyContinue
    if ($dbHost -like '*.pooler.supabase.com' -and $dbUser -notlike 'postgres.*') {
      Write-Host "Hint: the pooler requires the username postgres.<project-ref>, not plain 'postgres'." -ForegroundColor Yellow
    }
    Fail "pg_dump failed (exit $LASTEXITCODE).`n$tail"
  }
}
finally {
  $ErrorActionPreference = 'Stop'
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\PGSSLMODE -ErrorAction SilentlyContinue
}

# 5. Verify
if (-not (Test-Path $file)) { Fail 'Backup file was not created.' }
$info = Get-Item $file
if ($info.Length -le 0) { Fail 'Backup file is empty.' }

$list = & pg_restore --list $file 2>&1
if ($LASTEXITCODE -ne 0 -or -not $list) { Fail "pg_restore --list could not read the archive.`n$($list | Select-Object -First 5)" }
$entries = @($list | Where-Object { $_ -match '^\d+;' })
$hasTable = [bool]($entries | Where-Object { $_ -match ' TABLE DATA public catalogue_items ' })
$hasPolicy = [bool]($entries | Where-Object { $_ -match ' POLICY ' })
$hasTrigger = [bool]($entries | Where-Object { $_ -match ' TRIGGER ' })
if ($entries.Count -eq 0 -or -not $hasTable) {
  Fail 'Archive was readable but does not contain public.catalogue_items data. Do not rely on this backup.'
}

Write-Host ''
Write-Host 'BACKUP STATUS: SUCCESS' -ForegroundColor Green
Write-Host "File:        $($info.FullName)"
Write-Host ("Size:        {0:N0} bytes ({1:N2} MB)" -f $info.Length, ($info.Length / 1MB))
Write-Host "Created:     $($info.CreationTime.ToString('s'))"
Write-Host "Archive:     VALID - pg_restore --list read $($entries.Count) entries"
Write-Host "Contains:    catalogue_items data=$hasTable, RLS policies=$hasPolicy, triggers=$hasTrigger"
Write-Host "Log:         $file.log (no credentials)"
Write-Host ''
Write-Host 'NOTE: listing the archive proves it is readable, not that it restores correctly.' -ForegroundColor Yellow
Write-Host 'Do a test restore into a scratch database before relying on it.'
Write-Host 'Not covered: Supabase Storage objects (files), Auth-schema internals if not included, secrets, Edge Functions, project settings.'
