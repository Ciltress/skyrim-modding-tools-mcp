# Installs Skyrim Modding Tools - MCP Server on Windows, or updates it: run it again for each new version.
#
# It brings git and Node.js where they are missing (with winget, asking first), fetches the newest version
# from GitHub into your user folder's skyrim-modding-tools-mcp (or the folder -Dir names) and runs its setup,
# which asks for the rest. Your settings (.env) and your projects stay where they are.
#
#   "Install on Windows.cmd" runs this; or, in PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 [-Dir <folder>] [-Instance <the folder with ModOrganizer.ini>]
#
# Plain ASCII on purpose: Windows PowerShell 5.1 reads a script without a byte order mark in the ANSI code page.

param(
    [string]$Dir = (Join-Path $HOME 'skyrim-modding-tools-mcp'),
    [string]$Instance
)

# Continue, not Stop: where PowerShell's own output is redirected, it turns each line a program writes to stderr
# (npm's warnings, git's notes) into an error, and Stop would end the script there. Each step checks its exit code.
$ErrorActionPreference = 'Continue'
$Repo = 'https://github.com/Ciltress/skyrim-modding-tools-mcp.git'
$Branch = 'main'
$NodeMin = [version]'24.18.0'

function Say([string]$Text) { Write-Host $Text }
function Step([string]$Title) { Write-Host ''; Write-Host "== $Title" -ForegroundColor Cyan }
function Fail([string]$Text) { Write-Host ''; Write-Host $Text -ForegroundColor Red; exit 1 }
# Yes on Enter; never yes where no one can answer.
function Ask([string]$Question) {
    if ([Console]::IsInputRedirected -or -not [Environment]::UserInteractive) { return $false }
    $answer = Read-Host "$Question [Y/n]"
    return $answer.Trim() -match '^(|y|yes|j|ja)$'
}
function Has([string]$Program) { return [bool](Get-Command $Program -ErrorAction SilentlyContinue) }
# A program installed by winget is on the PATH of new windows; this one reads it again.
function Update-SessionPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function NodeVersion {
    if (-not (Has 'node')) { return $null }
    try { return [version]((& node --version) -replace '^v', '') } catch { return $null }
}
function NodeOk { $v = NodeVersion; return ($null -ne $v -and $v -ge $NodeMin) }
# Runs git, and stops when it fails; what git said is shown above. (Not named Git: PowerShell would then
# find the function for every git, this one's own included.)
function GitOrFail {
    & git @args
    if ($LASTEXITCODE -ne 0) { Fail "git $($args -join ' ') failed." }
}
function WingetInstall([string]$Id, [string]$What) {
    if (-not (Has 'winget')) { return $false }
    if (-not (Ask "Install $What with winget?")) { return $false }
    & winget install --exact --id $Id --accept-package-agreements --accept-source-agreements
    Update-SessionPath
    return $true
}

Step '1. git and Node.js'
if (Has 'git') {
    Say 'git is installed.'
} else {
    [void](WingetInstall 'Git.Git' 'Git')
    if (-not (Has 'git')) { Fail 'git is missing. Install it (https://git-scm.com/download/win), then run this again.' }
}
if (NodeOk) {
    Say "Node.js $(& node --version) is installed."
} else {
    if (Has 'node') { Say "Node.js $(& node --version) is too old: the server needs $NodeMin or later." }
    [void](WingetInstall 'OpenJS.NodeJS.LTS' 'Node.js')
    if (-not (NodeOk)) { Fail "Node.js $NodeMin or later is missing. Install Node.js (https://nodejs.org, the LTS), then run this again." }
    Say "Node.js $(& node --version) is installed."
}

Step '2. The server'
$package = Join-Path $Dir 'package.json'
if (Test-Path (Join-Path $Dir '.git')) {
    Say "Updating $Dir"
    Set-Location $Dir
    if (@(& git remote) -notcontains 'origin') { GitOrFail remote add origin $Repo }
    $current = (& git symbolic-ref --quiet --short HEAD 2> $null)
    if ($current -and $current -ne $Branch) { Fail "$Dir is on the branch $current, not ${Branch}: update it yourself with git." }
    $changed = (& git status --porcelain --untracked-files=no) -join "`n"
    if ($changed) {
        Fail "These files of the server were changed in ${Dir}:`n$changed`nUndo the changes (git -C `"$Dir`" checkout -- .) or keep them elsewhere, then run this again."
    }
    GitOrFail fetch --quiet origin $Branch
    if (-not $current) {
        & git checkout --quiet $Branch 2> $null
        if ($LASTEXITCODE -ne 0) { GitOrFail checkout --quiet -b $Branch "origin/$Branch" }
    }
    & git merge --quiet --ff-only "origin/$Branch"
    if ($LASTEXITCODE -ne 0) { Fail "$Dir has commits of its own on $Branch, which the newest version does not have: update it yourself with git." }
} elseif ((Test-Path $package) -and ((Get-Content $package -Raw) -match '"name": "skyrim-modding-tools-mcp"')) {
    # A folder unpacked from an older download: made a clone where it is, its .env and projects kept.
    Say "Making $Dir a clone of the server, so it can be updated"
    Set-Location $Dir
    GitOrFail init --quiet
    GitOrFail remote add origin $Repo
    GitOrFail fetch --quiet origin $Branch
    GitOrFail checkout --quiet --force -B $Branch "origin/$Branch"
} elseif ((Test-Path $Dir) -and (Get-ChildItem -Force $Dir | Select-Object -First 1)) {
    Fail "$Dir is there and holds something else. Name another folder: -Dir <folder>."
} else {
    Say "Downloading the server into $Dir"
    GitOrFail clone --quiet --branch $Branch $Repo $Dir
    Set-Location $Dir
}
$version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
Say "The server is at version $version ($(& git log -1 --format='%h, %cs'))."

Step '3. Setup'
$setupArgs = @('run', 'setup')
if ($Instance) { $setupArgs += @('--', '--instance', $Instance) }
# npm.cmd, not npm: npm.ps1 is a script, which an execution policy can refuse.
& npm.cmd @setupArgs
if ($LASTEXITCODE -ne 0) { Fail 'Setup failed: what it said is above.' }

Say ''
Say 'To update later, run this installer again.'
