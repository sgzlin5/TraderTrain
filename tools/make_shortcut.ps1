# TraderTrain 桌面快捷方式（带图标）
# 目标：start.bat（起本地服务 + 无地址栏 Chrome 窗口），图标取 app\assets\icon.ico
param([string]$Name = 'TraderTrain')

$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$bat   = Join-Path $root 'start.bat'
$icon  = Join-Path $root 'app\assets\icon.ico'

if (-not (Test-Path $bat))  { throw "找不到 start.bat: $bat" }
if (-not (Test-Path $icon)) { throw "找不到 icon.ico: $icon（先跑 python tools\make_icon.py）" }

$shell = New-Object -ComObject WScript.Shell

function New-Lnk([string]$lnkPath) {
  $s = $shell.CreateShortcut($lnkPath)
  $s.TargetPath       = $bat
  $s.Arguments        = ''
  $s.WorkingDirectory = $root
  $s.IconLocation     = "$icon,0"
  $s.WindowStyle      = 7            # 7 = 最小化：只留应用窗口，不弹控制台
  $s.Description      = 'TraderTrain - 复盘行情，沉淀判断。'
  $s.Save()
  return $s
}

$desktop = [Environment]::GetFolderPath('Desktop')
$targets = @(
  (Join-Path $desktop "$Name.lnk"),
  (Join-Path $root   "$Name.lnk")
)

foreach ($t in $targets) {
  New-Lnk $t | Out-Null
  # 回读校验：路径/图标必须真的写进去了
  $r = $shell.CreateShortcut($t)
  $ok = ($r.TargetPath -eq $bat) -and ($r.IconLocation -like "$icon*") -and (Test-Path $r.IconLocation.Split(',')[0])
  [pscustomobject]@{
    Shortcut = $t
    Target   = $r.TargetPath
    Icon     = $r.IconLocation
    Style    = $r.WindowStyle
    Ok       = $ok
  }
}
