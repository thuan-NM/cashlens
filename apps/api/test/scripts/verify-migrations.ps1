<#
.SYNOPSIS
Verifies CashLens Prisma migrations (OPS-001, OPS-003, TEST-007).

.DESCRIPTION
Runs four checks and exits 0 (all pass), 1 (a check failed), or 2 (a
prerequisite is missing: node, git, base ref, or database server).

  1. Unmodified history: no migration that exists at merge-base(BaseRef, HEAD)
     was modified, renamed, or deleted, whether committed or in the working
     tree. Because that merge base can predate the existing migrations, every
     folder up to -BaselineMigration is also pinned to the commit that first
     added the baseline, and any other folder must sort after the baseline.
     New migration folders are allowed; history is never rewritten.
  2. Empty database: every migration applies to a fresh database, and the
     result matches the Prisma schema (no drift).
  3. Current-schema upgrade: a fresh database first receives only the
     migrations up to -BaselineMigration (the pre-feature schema), then the
     full set applies on top without error and without drift.
  4. Repeated deploy: deploying again to both databases is a no-op.

Disposable databases are named test_migrations_<run>_<kind>, created through
-AdminUrl (a role with CREATEDB), and always dropped afterwards. Connection
passwords are never printed.

.PARAMETER AdminUrl
postgresql:// URL of a maintenance database on the server to test against.
Defaults to $env:MIGRATION_CHECK_ADMIN_URL, then to the development compose
database on localhost:$env:POSTGRES_HOST_PORT (default 5432).

.EXAMPLE
./apps/api/test/scripts/verify-migrations.ps1

.EXAMPLE
$env:POSTGRES_HOST_PORT = '55432'; ./apps/api/test/scripts/verify-migrations.ps1
#>
[CmdletBinding()]
param(
  [string]$AdminUrl,
  [string]$BaselineMigration = '20260627090000_budgets_goals_alerts_dashboard',
  [string]$BaseRef = 'origin/main',
  [string]$MigrationsPath,
  [string]$SchemaPath,
  [string]$RepoRoot,
  [switch]$SkipDatabase
)

Set-StrictMode -Version Latest
# 'Continue': Windows PowerShell 5.1 turns native stderr into terminating errors under 'Stop'.
$ErrorActionPreference = 'Continue'

$apiDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $apiDir '..\..')).Path }
if (-not $MigrationsPath) { $MigrationsPath = Join-Path $apiDir 'prisma\migrations' }
if (-not $SchemaPath) { $SchemaPath = Join-Path $apiDir 'prisma\schema.prisma' }
if (-not $AdminUrl) { $AdminUrl = $env:MIGRATION_CHECK_ADMIN_URL }
if (-not $AdminUrl) {
  $port = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { '5432' }
  # Development compose defaults (documented placeholders, never production).
  $AdminUrl = "postgresql://cashlens:cashlens_password@localhost:$port/postgres"
}

$results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$Check, [bool]$Pass, [string]$Detail = '') {
  $results.Add([pscustomobject]@{ Check = $Check; Result = $(if ($Pass) { 'PASS' } else { 'FAIL' }); Detail = $Detail })
}

function Exit-Prerequisite([string]$Message) {
  Write-Host "PREREQUISITE: $Message"
  exit 2
}

function Hide-Password([string]$Url) {
  return ($Url -replace '(://[^:/@]+:)[^@]*@', '$1***@' -replace '([?&]password=)[^&]*', '$1***')
}

function Get-MigrationFolder([string]$Line) {
  if ($Line -match 'prisma/migrations/([^/]+)/') { return $Matches[1] }
  return $null
}

# --- 1. Unmodified history ----------------------------------------------------
function Test-History {
  $null = & git -C $RepoRoot rev-parse --verify --quiet $BaseRef 2>$null
  if ($LASTEXITCODE -ne 0) { Exit-Prerequisite "base ref '$BaseRef' not found (run: git fetch origin main)" }
  $mergeBase = (& git -C $RepoRoot merge-base $BaseRef HEAD 2>$null | Select-Object -First 1)
  if (-not $mergeBase) { Exit-Prerequisite "no merge base between '$BaseRef' and HEAD" }

  $relative = 'apps/api/prisma/migrations'
  $lines = @()
  $lines += & git -C $RepoRoot diff --name-status --no-renames $mergeBase HEAD -- $relative 2>$null
  $lines += & git -C $RepoRoot diff --name-status --no-renames HEAD -- $relative 2>$null
  $violations = @($lines | Where-Object { $_ -and $_ -notmatch '^A\s' } | Sort-Object -Unique)
  $atBase = @(& git -C $RepoRoot ls-tree -d --name-only $mergeBase "$relative/" 2>$null).Count
  $detail = if ($violations.Count) { 'changed: ' + (($violations | ForEach-Object { $_ -replace '\s+', ' ' }) -join '; ') } else { "base $($mergeBase.Substring(0, 12)) ($atBase migrations at base)" }
  Add-Result 'history: pre-existing migrations unmodified' ($violations.Count -eq 0) $detail

  # Pin every folder up to the baseline to the commit that first added it (git log is newest first).
  $added = @(& git -C $RepoRoot log --diff-filter=A --format=%H HEAD -- "$relative/$BaselineMigration" 2>$null | Where-Object { $_ })
  if (-not $added.Count) { Exit-Prerequisite "baseline migration '$BaselineMigration' is not in the history of HEAD" }
  $pin = $added[-1]
  $protected = @(& git -C $RepoRoot ls-tree -d --name-only $pin "$relative/" 2>$null |
      ForEach-Object { ($_ -split '/')[-1] } |
      Where-Object { [string]::CompareOrdinal($_, $BaselineMigration) -le 0 })
  $pinned = @()
  $pinned += & git -C $RepoRoot diff --name-status --no-renames $pin -- $relative 2>$null
  $pinned += & git -C $RepoRoot ls-files --others --exclude-standard -- $relative 2>$null | ForEach-Object { "?`t$_" }
  $pinnedViolations = @($pinned | Where-Object { $_ -and ($protected -contains (Get-MigrationFolder $_)) } | Sort-Object -Unique)
  $detail = if ($pinnedViolations.Count) { 'changed: ' + (($pinnedViolations | ForEach-Object { $_ -replace '\s+', ' ' }) -join '; ') } else { "pinned $($pin.Substring(0, 12)) ($($protected.Count) folders)" }
  Add-Result 'history: migrations up to baseline unmodified' ($pinnedViolations.Count -eq 0) $detail

  # New migrations must sort after the baseline (strictly increasing timestamps).
  $early = @(Get-ChildItem -LiteralPath (Join-Path $RepoRoot $relative) -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { $_.Name } |
      Where-Object { ($protected -notcontains $_) -and [string]::CompareOrdinal($_, $BaselineMigration) -le 0 })
  Add-Result 'history: new migrations sort after baseline' ($early.Count -eq 0) $(if ($early.Count) { 'not after baseline: ' + ($early -join ', ') } else { '' })
}

# --- helpers for database checks -----------------------------------------------
function Get-NodeScript([string]$Body) {
  # Runs with apps/api as the resolution root so `pg` and `prisma` resolve.
  return "process.chdir(process.argv[1]); $Body"
}

function Invoke-AdminSql([string]$Sql) {
  $env:VERIFY_MIGRATIONS_ADMIN_URL = $AdminUrl
  $env:VERIFY_MIGRATIONS_SQL = $Sql
  $js = Get-NodeScript "const {Client}=require(require.resolve('pg',{paths:[process.cwd()]}));const c=new Client({connectionString:process.env.VERIFY_MIGRATIONS_ADMIN_URL});c.connect().then(()=>c.query(process.env.VERIFY_MIGRATIONS_SQL)).then(()=>c.end()).catch(e=>{console.error(e.code||e.message);process.exit(1)})"
  $output = & node -e $js $apiDir 2>&1 | Out-String
  $code = $LASTEXITCODE
  Remove-Item Env:VERIFY_MIGRATIONS_ADMIN_URL, Env:VERIFY_MIGRATIONS_SQL -ErrorAction SilentlyContinue
  return @{ Code = $code; Output = $output.Trim() }
}

function Get-DatabaseUrl([string]$Name) {
  $builder = [System.UriBuilder]$AdminUrl
  $builder.Path = "/$Name"
  $builder.Query = 'schema=public'
  return $builder.Uri.AbsoluteUri
}

function New-PrismaWorkspace([string]$Name, [string[]]$MigrationFolders) {
  # Inside apps/api/node_modules so `prisma/config` resolves; git-ignored and removed afterwards.
  $dir = Join-Path $apiDir "node_modules\.cache\verify-migrations\$script:runId-$Name"
  $migrationsDir = Join-Path $dir 'migrations'
  New-Item -ItemType Directory -Path $migrationsDir -Force | Out-Null
  Copy-Item -LiteralPath $SchemaPath -Destination (Join-Path $dir 'schema.prisma')
  $lock = Join-Path $MigrationsPath 'migration_lock.toml'
  if (Test-Path -LiteralPath $lock) { Copy-Item -LiteralPath $lock -Destination $migrationsDir }
  foreach ($folder in $MigrationFolders) {
    Copy-Item -LiteralPath (Join-Path $MigrationsPath $folder) -Destination $migrationsDir -Recurse
  }
  $config = @(
    'import { defineConfig } from "prisma/config";',
    'export default defineConfig({',
    '  schema: "schema.prisma",',
    '  migrations: { path: "migrations" },',
    '  datasource: { url: process.env["DATABASE_URL"] },',
    '});'
  ) -join "`n"
  [System.IO.File]::WriteAllText((Join-Path $dir 'prisma.config.ts'), $config, (New-Object System.Text.UTF8Encoding($false)))
  return $dir
}

function Invoke-Prisma([string]$Workspace, [string]$DatabaseUrl, [string[]]$Arguments) {
  # Restore the caller's values afterwards: a dot-sourced run shares the session.
  $previous = @{ DATABASE_URL = $env:DATABASE_URL; PRISMA_HIDE_UPDATE_MESSAGE = $env:PRISMA_HIDE_UPDATE_MESSAGE }
  $env:DATABASE_URL = $DatabaseUrl
  $env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
  # Never run inside the workspace: Windows cannot delete a directory that is
  # still the working directory of a lingering Prisma engine process.
  Push-Location $apiDir
  try {
    $output = & node $script:prismaCli @Arguments --config (Join-Path $Workspace 'prisma.config.ts') 2>&1 | Out-String
    $code = $LASTEXITCODE
  }
  finally {
    Pop-Location
    foreach ($name in $previous.Keys) {
      if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$name" $previous[$name] }
    }
  }
  return @{ Code = $code; Output = $output }
}

function Test-Deploy([string]$Label, [string]$Workspace, [string]$DatabaseUrl) {
  $deploy = Invoke-Prisma $Workspace $DatabaseUrl @('migrate', 'deploy')
  $ok = $deploy.Code -eq 0
  $detail = if ($ok) { '' } else { ($deploy.Output -split "`n" | Where-Object { $_ -match 'Error|error|failed|P3\d{3}' } | Select-Object -First 3) -join ' | ' }
  Add-Result "${Label}: migrate deploy applies" $ok $detail
  return $ok
}

function Test-Drift([string]$Label, [string]$Workspace, [string]$DatabaseUrl) {
  $diff = Invoke-Prisma $Workspace $DatabaseUrl @('migrate', 'diff', '--from-config-datasource', '--to-schema', (Join-Path $Workspace 'schema.prisma'), '--exit-code')
  $detail = switch ($diff.Code) { 0 { 'database matches schema' } 2 { 'schema differs from migrated database' } default { 'diff failed' } }
  Add-Result "${Label}: no drift between migrations and schema" ($diff.Code -eq 0) $detail
}

function Test-Repeat([string]$Label, [string]$Workspace, [string]$DatabaseUrl) {
  $again = Invoke-Prisma $Workspace $DatabaseUrl @('migrate', 'deploy')
  $noop = $again.Code -eq 0 -and $again.Output -match 'No pending migrations'
  Add-Result "${Label}: repeated deploy is a no-op" $noop ''
}

# --- run -----------------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Exit-Prerequisite 'git is not installed' }
Test-History

$script:runId = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
$createdDatabases = New-Object System.Collections.Generic.List[string]
$workspaces = New-Object System.Collections.Generic.List[string]

if (-not $SkipDatabase) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Exit-Prerequisite 'node is not installed' }
  $script:prismaCli = (& node -p "require.resolve('prisma/build/index.js',{paths:[process.argv[1]]})" $apiDir 2>$null | Select-Object -First 1)
  if (-not $script:prismaCli) { Exit-Prerequisite 'Prisma CLI not found; run yarn install' }
  $ping = Invoke-AdminSql 'SELECT 1'
  if ($ping.Code -ne 0) { Exit-Prerequisite "cannot reach $(Hide-Password $AdminUrl) ($($ping.Output))" }

  $allFolders = @(Get-ChildItem -LiteralPath $MigrationsPath -Directory | Sort-Object Name | ForEach-Object { $_.Name })
  if ($allFolders -notcontains $BaselineMigration) { Exit-Prerequisite "baseline migration '$BaselineMigration' not found" }
  $baselineFolders = @($allFolders | Where-Object { [string]::CompareOrdinal($_, $BaselineMigration) -le 0 })

  try {
    $fullWorkspace = New-PrismaWorkspace 'full' $allFolders
    $baselineWorkspace = New-PrismaWorkspace 'baseline' $baselineFolders
    $workspaces.Add($fullWorkspace); $workspaces.Add($baselineWorkspace)

    foreach ($kind in @('empty', 'upgrade')) {
      $name = "test_migrations_$($script:runId)_$kind"
      $create = Invoke-AdminSql "CREATE DATABASE `"$name`""
      if ($create.Code -ne 0) { Exit-Prerequisite "cannot create database $name ($($create.Output))" }
      $createdDatabases.Add($name)
    }
    $emptyUrl = Get-DatabaseUrl "test_migrations_$($script:runId)_empty"
    $upgradeUrl = Get-DatabaseUrl "test_migrations_$($script:runId)_upgrade"

    # 2. Empty database
    if (Test-Deploy 'empty database' $fullWorkspace $emptyUrl) {
      Test-Drift 'empty database' $fullWorkspace $emptyUrl
      Test-Repeat 'empty database' $fullWorkspace $emptyUrl
    }

    # 3. Current-schema upgrade (baseline subset first, then everything)
    $baselineApplied = Invoke-Prisma $baselineWorkspace $upgradeUrl @('migrate', 'deploy')
    Add-Result "upgrade: baseline ($($baselineFolders.Count) of $($allFolders.Count) migrations) applies" ($baselineApplied.Code -eq 0) $BaselineMigration
    if ($baselineApplied.Code -eq 0 -and (Test-Deploy 'upgrade from current schema' $fullWorkspace $upgradeUrl)) {
      Test-Drift 'upgrade from current schema' $fullWorkspace $upgradeUrl
      Test-Repeat 'upgrade from current schema' $fullWorkspace $upgradeUrl
    }
  }
  finally {
    foreach ($name in $createdDatabases) {
      $null = Invoke-AdminSql "DROP DATABASE IF EXISTS `"$name`" WITH (FORCE)"
    }
    # Windows can keep a handle on a workspace briefly after Prisma exits
    # (antivirus, OneDrive sync), so removal is retried a few times.
    foreach ($dir in $workspaces) {
      for ($attempt = 1; $attempt -le 10 -and (Test-Path -LiteralPath $dir); $attempt++) {
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $dir) { Start-Sleep -Milliseconds 300 }
      }
    }
  }
}

Write-Host "Migration verification against $(if ($SkipDatabase) { '(database checks skipped)' } else { Hide-Password $AdminUrl })"
$results | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
if (@($results | Where-Object { $_.Result -eq 'FAIL' }).Count -gt 0) { exit 1 }
exit 0
