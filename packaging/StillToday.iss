#ifndef SourceDir
  #error SourceDir must point to the staged application directory.
#endif
#ifndef OutputDir
  #error OutputDir must point to the installer output directory.
#endif
#ifndef AppVersion
  #error AppVersion must be provided by the packaging script.
#endif

[Setup]
; Same AppId as the WPF releases, so this installs over them in place.
AppId={{8E3E0966-2E76-4FF2-A506-85D85BED18AA}
AppName=Still Today
AppVersion={#AppVersion}
AppVerName=Still Today {#AppVersion}
AppPublisher=Still Today
DefaultDirName={localappdata}\Programs\Still Today
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; The WPF release ran as DesktopKanban.App; either one must be closed before files are replaced.
AppMutex=Local\StillToday.App,Local\DesktopKanban.App
CloseApplications=yes
RestartApplications=no
OutputDir={#OutputDir}
OutputBaseFilename=StillToday-{#AppVersion}-win-x64-setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\StillToday.exe
VersionInfoProductName=Still Today
VersionInfoVersion={#AppVersion}

[InstallDelete]
; What the self-contained WPF release left behind: its own binaries, the bundled .NET runtime and
; its per-language resource folders.
Type: files; Name: "{app}\*.dll"
Type: files; Name: "{app}\DesktopKanban.App.*"
Type: files; Name: "{app}\createdump.exe"
Type: filesandordirs; Name: "{app}\Assets"
Type: filesandordirs; Name: "{app}\cs"
Type: filesandordirs; Name: "{app}\de"
Type: filesandordirs; Name: "{app}\es"
Type: filesandordirs; Name: "{app}\fr"
Type: filesandordirs; Name: "{app}\it"
Type: filesandordirs; Name: "{app}\ja"
Type: filesandordirs; Name: "{app}\ko"
Type: filesandordirs; Name: "{app}\pl"
Type: filesandordirs; Name: "{app}\pt-BR"
Type: filesandordirs; Name: "{app}\ru"
Type: filesandordirs; Name: "{app}\tr"
Type: filesandordirs; Name: "{app}\zh-Hans"
Type: filesandordirs; Name: "{app}\zh-Hant"
; The page is replaced whole, so no stale hashed asset outlives an update.
Type: filesandordirs; Name: "{app}\ui"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Still Today"; Filename: "{app}\StillToday.exe"; WorkingDir: "{app}"
Name: "{userprograms}\Uninstall Still Today"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\StillToday.exe"; Description: "Launch Still Today"; Flags: nowait postinstall skipifsilent

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  OldRunValue = 'DesktopKanban';
  RunValue = 'StillToday';

function PointsInto(Command, Path: string): Boolean;
begin
  Result := (Pos(Lowercase(Path), Lowercase(Command)) > 0);
end;

// "Start with Windows" carries over from the WPF release when it pointed at this installation.
procedure CurStepChanged(CurStep: TSetupStep);
var
  Existing: string;
begin
  if CurStep <> ssPostInstall then Exit;
  if RegQueryStringValue(HKCU, RunKey, OldRunValue, Existing) and PointsInto(Existing, ExpandConstant('{app}\DesktopKanban.App.exe')) then
  begin
    RegDeleteValue(HKCU, RunKey, OldRunValue);
    RegWriteStringValue(HKCU, RunKey, RunValue, AddQuotes(ExpandConstant('{app}\StillToday.exe')) + ' --autostart');
  end
  else if RegQueryStringValue(HKCU, RunKey, RunValue, Existing) then
    RegWriteStringValue(HKCU, RunKey, RunValue, AddQuotes(ExpandConstant('{app}\StillToday.exe')) + ' --autostart');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Existing: string;
begin
  if CurUninstallStep <> usUninstall then Exit;
  if RegQueryStringValue(HKCU, RunKey, RunValue, Existing) and PointsInto(Existing, ExpandConstant('{app}\StillToday.exe')) then
    RegDeleteValue(HKCU, RunKey, RunValue);
end;
