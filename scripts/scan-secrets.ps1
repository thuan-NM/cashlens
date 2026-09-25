<#
.SYNOPSIS
Deterministic release secret scan for CashLens (CFG-006, SC-003, TEST-008).

.DESCRIPTION
Runs one pinned scanner (gitleaks v8.30.1, by digest) through Docker and exits
0 (clean), 1 (findings), or 2 (prerequisite or configuration error).

  1. Working tree. Git selects the files: every tracked file plus every
     untracked file that the ignore rules do not exclude
     (`git ls-files --cached --others --exclude-standard`). They are copied to
     a temporary directory outside the repository and scanned with gitleaks
     `dir`. Ignored files (local .env files, node_modules, dist, ...) are never
     read; a tracked or unignored env file always is.
  2. Feature history. gitleaks `git` scans every commit in <BaseRef>..HEAD on
     the repository mounted read-only, including secrets that were added and
     later removed.

Only redacted finding metadata is printed: rule, path, line, and commit.

Two kinds of exception exist, and nothing else is honoured:
  - the placeholder block in .gitleaks.toml, which must equal
    PLACEHOLDER_SECRETS in apps/api/src/config/placeholder-secrets.ts;
  - reviewed history findings in the root .gitleaksignore, each an exact
    commit-scoped fingerprint (<40-hex commit>:<path>:<rule>:<line>) of a commit
    in HEAD's history, preceded by a comment explaining it. Such a fingerprint
    cannot match the working tree or any other commit, file, line, or rule.
Inline `gitleaks:allow` comments are ignored, and a commit-less or wildcard
fingerprint, a nested .gitleaksignore, or any path, commit, or stopword
allowlist in .gitleaks.toml stops the scan.

.PARAMETER BaseRef
Historical baseline of the feature history scan. The default, 80f3e0d, is the
last commit of this branch that was merged into dev (PR #7); the range still
covers the implementation baseline b273f14 and every feature commit. The ref
must exist and be an ancestor of HEAD; otherwise the scan exits 2 and never
skips the history scan.

.PARAMETER RepoRoot
Repository to scan. Defaults to the repository containing this script.

.EXAMPLE
./scripts/scan-secrets.ps1
#>
[CmdletBinding()]
param(
  [string]$BaseRef = '80f3e0d',
  [string]$RepoRoot
)

Set-StrictMode -Version Latest
# 'Continue': Windows PowerShell 5.1 turns native stderr into terminating errors under 'Stop'.
$ErrorActionPreference = 'Continue'

# The one pinned scanner (research.md "Secret scanning"). Change it only here.
$GitleaksImage = 'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f'

function Exit-Prerequisite([string]$Message) {
  Write-Host "PREREQUISITE: $Message"
  exit 2
}

# --- preconditions (nothing is created before these pass) ---------------------
foreach ($tool in 'git', 'docker') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Exit-Prerequisite "$tool is not installed" }
}
if (-not $RepoRoot) { $RepoRoot = Join-Path $PSScriptRoot '..' }
$top = (& git -C $RepoRoot rev-parse --show-toplevel 2>$null | Select-Object -First 1)
if (-not $top) { Exit-Prerequisite "'$RepoRoot' is not a git working tree" }
$repo = (Resolve-Path -LiteralPath $top).Path

$null = & docker version --format '{{.Server.Version}}' 2>$null
if ($LASTEXITCODE -ne 0) { Exit-Prerequisite 'the Docker daemon is not reachable' }

$configFile = Join-Path $repo '.gitleaks.toml'
$placeholderFile = Join-Path $repo 'apps\api\src\config\placeholder-secrets.ts'
if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) { Exit-Prerequisite '.gitleaks.toml not found at the repository root' }
if (-not (Test-Path -LiteralPath $placeholderFile -PathType Leaf)) { Exit-Prerequisite 'apps/api/src/config/placeholder-secrets.ts not found' }

# Reviewed history exceptions: exact commit-scoped fingerprints only. gitleaks
# would treat a commit-less entry as global (every commit and the working tree).
$ignoreFile = Join-Path $repo '.gitleaksignore'
$exceptions = @()
if (Test-Path -LiteralPath $ignoreFile) {
  $previous = ''
  foreach ($raw in @(Get-Content -LiteralPath $ignoreFile)) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith('#')) { $previous = $line; continue }
    $parsed = [regex]::Match($line, '^(?<commit>[0-9a-f]{40}):(?<path>[^:*?\s]+):(?<rule>[a-z0-9-]+):(?<line>[1-9][0-9]*)$')
    if (-not $parsed.Success) {
      Exit-Prerequisite '.gitleaksignore may contain only exact commit-scoped fingerprints (<40-hex commit>:<path>:<rule>:<line>)'
    }
    if (-not $previous.StartsWith('#')) {
      Exit-Prerequisite '.gitleaksignore: each exception must directly follow a comment explaining why it exists'
    }
    $null = & git -C $repo merge-base --is-ancestor $parsed.Groups['commit'].Value HEAD 2>$null
    if ($LASTEXITCODE -ne 0) {
      Exit-Prerequisite ".gitleaksignore names commit $($parsed.Groups['commit'].Value.Substring(0, 7)), which is not in HEAD's history"
    }
    $exceptions += $line
    $previous = $line
  }
}

# The allowlist must be exactly the production-rejected placeholders (CFG-001).
$configText = Get-Content -Raw -LiteralPath $configFile
if ([regex]::Matches($configText, '(?m)^\s*\[\[allowlists\]\]').Count -ne 1 -or
    [regex]::IsMatch($configText, '(?m)^\s*\[allowlist\]') -or
    [regex]::IsMatch($configText, '(?m)^\s*(paths|commits|stopwords)\s*=')) {
  Exit-Prerequisite '.gitleaks.toml may contain only the placeholder allowlist (no path, commit, or stopword allowlists)'
}
$block = [regex]::Match($configText, '(?s)# BEGIN placeholder allowlist(?<body>.*?)# END placeholder allowlist')
$entry = "'''" + '\(\?i\)\^(?<v>[^$'']+)\$' + "'''"
$allowed = @([regex]::Matches($block.Groups['body'].Value, $entry) | ForEach-Object { $_.Groups['v'].Value.ToLowerInvariant() } | Sort-Object -Unique)
$placeholderText = Get-Content -Raw -LiteralPath $placeholderFile
$listBody = [regex]::Match($placeholderText, 'PLACEHOLDER_SECRETS\s*=\s*\[(?<body>[^\]]*)\]').Groups['body'].Value
$expected = @([regex]::Matches($listBody, "'(?<v>[^']+)'") | ForEach-Object { $_.Groups['v'].Value.ToLowerInvariant() } | Sort-Object -Unique)
if (-not $block.Success -or $expected.Count -eq 0 -or (Compare-Object $expected $allowed)) {
  Exit-Prerequisite '.gitleaks.toml placeholder allowlist differs from PLACEHOLDER_SECRETS in placeholder-secrets.ts'
}

$baseSha = (& git -C $repo rev-parse --verify --quiet "$BaseRef^{commit}" 2>$null | Select-Object -First 1)
if (-not $baseSha) { Exit-Prerequisite "base ref '$BaseRef' not found (a shallow clone needs: git fetch --unshallow)" }
$null = & git -C $repo merge-base --is-ancestor $baseSha HEAD 2>$null
if ($LASTEXITCODE -ne 0) { Exit-Prerequisite "base ref '$BaseRef' is not an ancestor of HEAD" }
$headSha = (& git -C $repo rev-parse HEAD | Select-Object -First 1)
$commitCount = [int](& git -C $repo rev-list --count "$baseSha..HEAD" | Select-Object -First 1)

# --- helpers -------------------------------------------------------------------
function Invoke-Gitleaks([string[]]$Arguments) {
  # The JSON report goes to stdout; gitleaks logs (errors only) go to stderr,
  # which is captured, echoed, and checked.
  $previous = $null
  $stderrFile = [System.IO.Path]::GetTempFileName()
  try { $previous = [Console]::OutputEncoding; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
  try {
    $stdout = & docker @Arguments 2> $stderrFile
    $code = $LASTEXITCODE
  }
  finally {
    if ($previous) { try { [Console]::OutputEncoding = $previous } catch { } }
  }
  # Windows PowerShell 5.1 wraps native stderr in error records; their
  # position decoration ("At ...", "+ ...") is dropped.
  $logLines = @(Get-Content -LiteralPath $stderrFile -ErrorAction SilentlyContinue |
      Where-Object { "$_".Trim() -and "$_" -notmatch '^\s*(At .*char:\d+|\+|~)' })
  Remove-Item -LiteralPath $stderrFile -Force -ErrorAction SilentlyContinue
  $logLines | ForEach-Object { Write-Host "  $_" }
  # Any gitleaks ERR line (for example a file it could not read) means the scan
  # was incomplete, so it can never count as clean.
  # Case-sensitive, after removing any colour codes (`\x1b[31mERR` would hide the level).
  $scanErrors = @($logLines | Where-Object { ("$_" -replace '\x1b\[[0-9;]*m', '') -cmatch '\bERR\b' })
  $text = (@($stdout) -join "`n").Trim()
  $findings = $null
  if ($text) {
    try { $findings = @($text | ConvertFrom-Json | ForEach-Object { $_ } | Where-Object { $_ }) } catch { $findings = $null }
  }
  # gitleaks also exits 1 on fatal errors, so a result only counts with a parsable report.
  $status = if ($null -eq $findings -or $code -notin 0, 1) { 'error' } elseif ($findings.Count -gt 0) { 'findings' } elseif ($scanErrors.Count -gt 0) { 'error' } elseif ($code -eq 0) { 'clean' } else { 'error' }
  return @{ Status = $status; Findings = @($findings | Where-Object { $_ }); Code = $code }
}

function Write-Findings([string]$Scan, [object[]]$Findings) {
  foreach ($f in $Findings) {
    # Secret and Match are never printed (they are redacted by gitleaks as well).
    $path = ([string]$f.File) -replace '^/scan/', ''
    $commit = if ($f.PSObject.Properties['Commit'] -and $f.Commit) { " commit $(([string]$f.Commit).Substring(0, 7))" } else { '' }
    Write-Host ("  [{0}] {1} {2}:{3}{4}" -f $Scan, $f.RuleID, $path, $f.StartLine, $commit)
  }
}

$common = @('--gitleaks-ignore-path', '/cfg', '--ignore-gitleaks-allow', '--config', '/cfg/.gitleaks.toml',
  '--redact', '--no-banner', '--no-color', '--log-level', 'error', '--exit-code', '1',
  '--report-format', 'json', '--report-path', '-')

# --- scans ---------------------------------------------------------------------
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('cashlens-secret-scan-' + [guid]::NewGuid().ToString('N'))
if ($stage.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) { Exit-Prerequisite 'the temporary directory is inside the repository' }
$exitCode = 2
try {
  $filesDir = Join-Path $stage 'files'
  $configDir = Join-Path $stage 'cfg'
  New-Item -ItemType Directory -Path $filesDir, $configDir -Force | Out-Null
  Copy-Item -LiteralPath $configFile -Destination (Join-Path $configDir '.gitleaks.toml')

  # 1. Working tree: the Git-selected file set, staged outside the repository.
  $selected = & git -C $repo -c core.quotePath=false ls-files -z --cached --others --exclude-standard
  $paths = @((@($selected) -join '') -split "`0" | Where-Object { $_ } | Sort-Object -Unique)
  $staged = 0
  $refused = $false
  foreach ($relative in $paths) {
    # Only the validated root file is allowed; it is scanned like any other file.
    if ($relative -ne '.gitleaksignore' -and (Split-Path -Leaf $relative) -eq '.gitleaksignore') { $refused = $true; break }
    $source = Join-Path $repo $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }  # deleted on disk
    $target = Join-Path $filesDir $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
    $staged++
  }
  if ($refused) {
    Write-Host 'PREREQUISITE: a nested .gitleaksignore is not allowed; reviewed exceptions live only in the root .gitleaksignore'
  }
  else {
    Write-Host "Secret scan: gitleaks v8.30.1 (pinned digest), config .gitleaks.toml"
    Write-Host ("Reviewed history exceptions (.gitleaksignore): {0}" -f $exceptions.Count)
    $tree = Invoke-Gitleaks (@('run', '--rm', '-e', 'NO_COLOR=1', '-v', "${filesDir}:/scan:ro", '-v', "${configDir}:/cfg:ro", $GitleaksImage, 'dir', '/scan') + $common)
    Write-Host ("Working tree: {0} files (tracked + untracked, not ignored): {1}" -f $staged, $(if ($tree.Status -eq 'findings') { "$($tree.Findings.Count) finding(s)" } else { $tree.Status }))
    Write-Findings 'worktree' $tree.Findings

    # 2. Feature history: every commit in base..HEAD, repository mounted read-only.
    $gitSafe = @('-e', 'GIT_CONFIG_COUNT=1', '-e', 'GIT_CONFIG_KEY_0=safe.directory', '-e', 'GIT_CONFIG_VALUE_0=/repo')
    $history = Invoke-Gitleaks (@('run', '--rm', '-e', 'NO_COLOR=1') + $gitSafe + @('-v', "${repo}:/repo:ro", '-v', "${configDir}:/cfg:ro", $GitleaksImage, 'git', '/repo', "--log-opts=$baseSha..HEAD") + $common)
    Write-Host ("History: {0}..{1} ({2} commits): {3}" -f $baseSha.Substring(0, 7), $headSha.Substring(0, 7), $commitCount, $(if ($history.Status -eq 'findings') { "$($history.Findings.Count) finding(s)" } else { $history.Status }))
    Write-Findings 'history' $history.Findings

    $exitCode = if ($tree.Status -eq 'findings' -or $history.Status -eq 'findings') { 1 }
                elseif ($tree.Status -eq 'error' -or $history.Status -eq 'error') { 2 }
                else { 0 }
    if ($exitCode -eq 2) { Write-Host 'PREREQUISITE: gitleaks did not produce a complete report (see the error above)' }
  }
}
finally {
  if (Test-Path -LiteralPath $stage) {
    # Copies keep a read-only attribute, which would block the recursive delete.
    Get-ChildItem -LiteralPath $stage -Recurse -Force -File | ForEach-Object { $_.Attributes = 'Normal' }
    [System.IO.Directory]::Delete($stage, $true)
  }
}
exit $exitCode
