# Still Today Windows installer

Run `scripts/packaging/Build-StillTodayInstaller.ps1` from PowerShell. It tests and builds the page
(`ui/`, pnpm), builds the host (`host/`, .NET SDK 10 targeting .NET Framework 4.8), stages only
the files that run, and writes `artifacts/installer/StillToday-0.2.3-win-x64-setup.exe` (about
2.5 MB). Building needs pnpm, the .NET 10 SDK and Inno Setup 7. Override the version with `-Version`.

Nothing is bundled that Windows 10 (1903 or later) and 11 already have: the host runs on the in-box .NET Framework 4.8 and
renders through the Evergreen WebView2 Runtime.

Setup installs for the current Windows user without elevation, adds a Start Menu shortcut, and
registers an uninstaller in Windows Settings. It installs over the WPF release in place (same
AppId), removing that release's bundled runtime, and carries "Start with Windows" over when it
pointed at the installation. Uninstall removes the binaries, shortcuts and that autostart value, and
leaves `%LOCALAPPDATA%\StillToday` (tasks, focus history, settings; the Canvas token and calendar
feed addresses are in Windows Credential Manager) so a reinstall keeps everything. On first run the
app imports the WPF release's data from `%LOCALAPPDATA%\DesktopKanban` once.
