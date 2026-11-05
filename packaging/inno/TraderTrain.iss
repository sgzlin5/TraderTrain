; TraderTrain 安装包（Inno Setup 6）
; 用法：ISCC.exe packaging\inno\TraderTrain.iss
; 约束：AppId 固定（覆盖升级才能识别）、只写 {app}、卸载默认保留数据

#define MyAppName "TraderTrain"
#define MyAppVersion "0.1.0"
#define MyAppExeName "TraderTrain-0.1.0.exe"
#define MyAppPublisher "sgzlin5"

[Setup]
AppId={{7C2B1E4A-9D3F-4E2A-9A1B-5D6F0C3B8E11}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=TraderTrain-{#MyAppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
UsePreviousAppDir=yes
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "zh"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README-EXE.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 只删程序文件；数据在 %LOCALAPPDATA%\TraderTrain（索引库/配置），默认保留
Type: filesandordirs; Name: "{app}"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\TraderTrain');
    if DirExists(DataDir) then
      if MsgBox('是否同时删除行情数据与配置？' + #13#10 + DataDir, mbConfirmation, MB_YESNO) = IDNO then
        ;
  end;
end;
