param(
  [string]$RepositoryUrl = "https://gitee.com/zui216/jimeng-image-downloader.git",
  [string]$RemoteName = "gitee",
  [string]$Branch = "main",
  [string]$DestinationPath = $PSScriptRoot,
  [string]$SuccessFlagPath = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step {
  param([string]$Message)
  Write-Host "[jimeng-image-downloader] $Message"
}

function Remove-PathSafely {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Get-SystemGitCommand {
  return Get-Command git -ErrorAction SilentlyContinue
}

function Get-BundledGitPath {
  param([string]$BasePath)

  return Join-Path $BasePath "tools\git\cmd\git.exe"
}

function Resolve-DestinationPath {
  param([string]$Path)

  if ($null -eq $Path) {
    $cleanPath = ""
  } else {
    $cleanPath = $Path.Trim()
  }

  $cleanPath = $cleanPath.Trim('"')

  if ([string]::IsNullOrWhiteSpace($cleanPath)) {
    throw "目标路径为空。"
  }

  while ($cleanPath.Length -gt 3 -and ($cleanPath.EndsWith("\") -or $cleanPath.EndsWith("/"))) {
    $cleanPath = $cleanPath.Substring(0, $cleanPath.Length - 1)
  }

  if ($cleanPath.Length -eq 2 -and $cleanPath[1] -eq ':') {
    $cleanPath += '\'
  }

  return [System.IO.Path]::GetFullPath($cleanPath)
}

function Get-PortableGitDownloadUrl {
  return "https://mirrors.huaweicloud.com/git-for-windows/v2.54.0.windows.1/MinGit-2.54.0-64-bit.zip"
}

function Download-FileWithProgress {
  param(
    [string]$Url,
    [string]$DestinationPath
  )

  $request = [System.Net.HttpWebRequest]::Create($Url)
  $request.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate

  $response = $null
  $responseStream = $null
  $fileStream = $null

  try {
    $response = $request.GetResponse()
    $responseStream = $response.GetResponseStream()
    $fileStream = [System.IO.File]::Create($DestinationPath)

    $buffer = New-Object byte[] 65536
    [long]$totalBytes = $response.ContentLength
    [long]$downloadedBytes = 0
    [int]$lastPercent = -1

    while (($bytesRead = $responseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $fileStream.Write($buffer, 0, $bytesRead)
      $downloadedBytes += $bytesRead

      if ($totalBytes -gt 0) {
        $percent = [int][Math]::Floor(($downloadedBytes * 100) / $totalBytes)
        if ($percent -ne $lastPercent) {
          Write-Progress -Activity "正在下载便携版 Git" -Status "$percent% ($downloadedBytes / $totalBytes 字节)" -PercentComplete $percent
          $lastPercent = $percent
        }
      } else {
        Write-Progress -Activity "正在下载便携版 Git" -Status "已下载 $downloadedBytes 字节" -PercentComplete 0
      }
    }

    Write-Progress -Activity "正在下载便携版 Git" -Completed
  } finally {
    if ($null -ne $fileStream) {
      $fileStream.Dispose()
    }

    if ($null -ne $responseStream) {
      $responseStream.Dispose()
    }

    if ($null -ne $response) {
      $response.Dispose()
    }
  }
}

function Install-BundledGit {
  param(
    [string]$BasePath,
    [string]$TempRoot
  )

  $gitRoot = Join-Path $BasePath "tools\git"
  $zipPath = Join-Path $TempRoot "mingit.zip"
  $extractPath = Join-Path $TempRoot "mingit"
  $downloadUrl = Get-PortableGitDownloadUrl

  Write-Step "正在下载便携版 Git..."
  Write-Step $downloadUrl
  Download-FileWithProgress -Url $downloadUrl -DestinationPath $zipPath

  Write-Step "正在安装便携版 Git..."
  Remove-PathSafely -Path $gitRoot
  New-Item -ItemType Directory -Path $extractPath | Out-Null
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
  New-Item -ItemType Directory -Path (Split-Path -Parent $gitRoot) -Force | Out-Null
  New-Item -ItemType Directory -Path $gitRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $extractPath -Force | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination $gitRoot -Force
  }

  $gitExe = Get-BundledGitPath -BasePath $BasePath
  if (-not (Test-Path -LiteralPath $gitExe)) {
    throw "便携版 Git 安装完成后，仍未找到 git.exe。"
  }

  return $gitExe
}

function Resolve-GitExecutable {
  param(
    [string]$BasePath,
    [string]$TempRoot
  )

  $bundledGit = Get-BundledGitPath -BasePath $BasePath
  if (Test-Path -LiteralPath $bundledGit) {
    return $bundledGit
  }

  $systemGit = Get-SystemGitCommand
  if ($null -ne $systemGit) {
    return $systemGit.Source
  }

  return Install-BundledGit -BasePath $BasePath -TempRoot $TempRoot
}

$resolvedDestination = Resolve-DestinationPath -Path $DestinationPath
$manifestPath = Join-Path $resolvedDestination "manifest.json"
$gitDirPath = Join-Path $resolvedDestination ".git"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "没有在当前目录找到 manifest.json。请把 update.bat 放在插件根目录后再运行。"
}

if (-not (Test-Path -LiteralPath $gitDirPath)) {
  throw "没有在当前目录找到 .git。这个更新脚本只适用于已经包含 Git 仓库的安装包。"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("jimeng-image-downloader-" + [System.Guid]::NewGuid().ToString("N"))

try {
  Write-Step "正在准备临时目录..."
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $gitExe = Resolve-GitExecutable -BasePath $resolvedDestination -TempRoot $tempRoot

  Write-Step "正在使用 Git：$gitExe"
  Write-Step "正在检查仓库状态..."
  & $gitExe -C $resolvedDestination rev-parse --is-inside-work-tree > $null
  if ($LASTEXITCODE -ne 0) {
    throw "当前目录不是有效的 Git 仓库。"
  }

  Write-Step "正在设置更新源..."
  & $gitExe -C $resolvedDestination remote > $null
  if ($LASTEXITCODE -ne 0) {
    throw "无法读取 Git 远端配置。"
  }

  $remoteList = (& $gitExe -C $resolvedDestination remote) | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if ($remoteList -notcontains $RemoteName) {
    & $gitExe -C $resolvedDestination remote add $RemoteName $RepositoryUrl
    if ($LASTEXITCODE -ne 0) {
      throw "无法创建远端 $RemoteName。"
    }
  }

  & $gitExe -C $resolvedDestination remote set-url $RemoteName $RepositoryUrl
  if ($LASTEXITCODE -ne 0) {
    throw "无法把远端 $RemoteName 设置为 HTTPS 地址。"
  }

  Write-Step "正在获取最新版本..."
  & $gitExe -C $resolvedDestination fetch --prune $RemoteName $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "git fetch 执行失败。"
  }

  Write-Step "正在丢弃本地改动..."
  & $gitExe -C $resolvedDestination reset --hard HEAD
  if ($LASTEXITCODE -ne 0) {
    throw "git reset --hard HEAD 执行失败。"
  }

  Write-Step "正在清理本地临时文件..."
  & $gitExe -C $resolvedDestination clean -fd
  if ($LASTEXITCODE -ne 0) {
    throw "git clean 执行失败。"
  }

  Write-Step "正在切换到最新版本..."
  & $gitExe -C $resolvedDestination reset --hard FETCH_HEAD
  if ($LASTEXITCODE -ne 0) {
    throw "git reset --hard FETCH_HEAD 执行失败。"
  }

  Write-Step "正在清理已删除的旧文件..."
  & $gitExe -C $resolvedDestination clean -fd
  if ($LASTEXITCODE -ne 0) {
    throw "git clean 执行失败。"
  }

  Write-Step "更新完成。"
  Write-Host ""
  Write-Host "更新完成。请回到 Chrome 扩展页面点一次“重新加载”。"
  if (-not [string]::IsNullOrWhiteSpace($SuccessFlagPath)) {
    Set-Content -LiteralPath $SuccessFlagPath -Value "ok" -Encoding ASCII
  }
  exit 0
} catch {
  Write-Error $_
  Write-Host ""
  Write-Host "如果提示网络失败，请确认电脑可以访问 Gitee 和华为云镜像。"
  Write-Host "如果提示文件被占用，请先关闭 Chrome 里的扩展详情页，再重新运行 update.bat。"
  Write-Host "如果你手动修改过插件目录里的文件，这次更新会把这些改动覆盖掉。"
  exit 1
} finally {
  try {
    Remove-PathSafely -Path $tempRoot
  } catch {
    Write-Warning ("临时目录清理失败：" + $_.Exception.Message)
  }
}
