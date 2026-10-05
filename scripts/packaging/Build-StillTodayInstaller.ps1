param(
    [string]$Version = '0.2.3'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outputRoot = Join-Path $repositoryRoot 'artifacts\installer'
$stage = Join-Path $outputRoot 'stage'
$ui = Join-Path $repositoryRoot 'ui'
$hostProject = Join-Path $repositoryRoot 'host\StillToday.csproj'
$hostOutput = Join-Path $repositoryRoot 'host\bin\Release\net48'
$script = Join-Path $repositoryRoot 'packaging\StillToday.iss'

$compiler = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 7\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 7\ISCC.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'Inno Setup 7 is required. Install JRSoftware.InnoSetup.7 first.' }

Push-Location $ui
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }
    pnpm run test
    if ($LASTEXITCODE -ne 0) { throw 'UI tests failed.' }
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw 'UI build failed.' }
}
finally { Pop-Location }

# A clean host build, so no page asset from an earlier build rides along.
if (Test-Path -LiteralPath $hostOutput) { Remove-Item -LiteralPath $hostOutput -Recurse -Force }
dotnet build $hostProject -c Release -p:Version=$Version -p:DebugType=None -p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw 'Host build failed.' }

# Only what runs: the host, WebView2's managed wrapper and loader, and the page. The runtimes live
# in Windows (.NET Framework 4.8 and the Evergreen WebView2 Runtime).
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($file in 'StillToday.exe', 'StillToday.exe.config', 'Microsoft.Web.WebView2.Core.dll', 'WebView2Loader.dll') {
    Copy-Item -LiteralPath (Join-Path $hostOutput $file) -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $hostOutput 'ui') -Destination $stage -Recurse

& $compiler "/DSourceDir=$stage" "/DOutputDir=$outputRoot" "/DAppVersion=$Version" $script
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }

$setup = Join-Path $outputRoot "StillToday-$Version-win-x64-setup.exe"
Get-Item -LiteralPath $setup | Select-Object FullName, Length
Get-FileHash -LiteralPath $setup -Algorithm SHA256 | Select-Object Hash
