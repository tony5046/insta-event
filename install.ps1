# install.ps1
# 인스타 자동 업로드 - 자동 셋업 스크립트
#
# 사용법 (PowerShell 관리자 권한):
#   irm https://raw.githubusercontent.com/tony5046/insta-event/main/install.ps1 | iex

$ErrorActionPreference = 'Continue'
$repoUrl = 'https://github.com/tony5046/insta-event.git'
$installDir = "$env:USERPROFILE\insta-event"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  인스타 자동 업로드 - 자동 셋업" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 관리자 권한 확인
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[X] 관리자 권한이 필요합니다!" -ForegroundColor Red
    Write-Host "    PowerShell을 관리자 권한으로 다시 열어주세요." -ForegroundColor Yellow
    pause
    exit 1
}

# 1. Node.js 설치
Write-Host "[1/5] Node.js 설치 확인..." -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "      [OK] 이미 설치됨: $(node --version)" -ForegroundColor Green
} else {
    Write-Host "      설치 중... (1~2분)"
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
    Write-Host "      [OK] 완료" -ForegroundColor Green
}

# 2. Git 설치
Write-Host "[2/5] Git 설치 확인..." -ForegroundColor Yellow
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "      [OK] 이미 설치됨" -ForegroundColor Green
} else {
    Write-Host "      설치 중... (1~2분)"
    winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
    Write-Host "      [OK] 완료" -ForegroundColor Green
}

# 3. 코드 다운로드
Write-Host "[3/5] 코드 다운로드..." -ForegroundColor Yellow
if (Test-Path $installDir) {
    Write-Host "      기존 폴더 발견, 업데이트 중..."
    Push-Location $installDir
    git pull
    Pop-Location
} else {
    git clone $repoUrl $installDir
}
Write-Host "      [OK] 완료: $installDir" -ForegroundColor Green

# 4. 패키지 설치
Write-Host "[4/5] 패키지 설치 (1~2분)..." -ForegroundColor Yellow
Push-Location $installDir
& npm install --silent 2>&1 | Out-Null
Pop-Location
Write-Host "      [OK] 완료" -ForegroundColor Green

# 5. 부팅 시 자동 시작 등록 (재부팅 대비)
Write-Host "[5/5] 부팅 시 자동 시작 등록..." -ForegroundColor Yellow
$startBat = Join-Path $installDir 'START.bat'
$bootAction = New-ScheduledTaskAction -Execute $startBat
$bootTrigger = New-ScheduledTaskTrigger -AtStartup
$bootSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
Unregister-ScheduledTask -TaskName 'InstaAutoUpload-Boot' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'InstaAutoUpload-Boot' -Action $bootAction -Trigger $bootTrigger -Settings $bootSettings -RunLevel Highest -User $env:USERNAME | Out-Null
Write-Host "      [OK] 완료" -ForegroundColor Green

# 서버 즉시 시작
Write-Host ""
Write-Host "서버 시작 중..." -ForegroundColor Yellow
Start-Process -FilePath $startBat -WorkingDirectory $installDir

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  [OK] 셋업 완료!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "자동 스케줄:" -ForegroundColor Cyan
Write-Host "   매일 오전 10:00 - 인스타 자동 업로드"
Write-Host ""
Write-Host "브라우저 주소:" -ForegroundColor Cyan
Write-Host "   http://localhost:3000/auto.html"
Write-Host ""
Write-Host "주의사항:" -ForegroundColor Yellow
Write-Host "   - 노트북 24시간 켜져 있어야 함"
Write-Host "   - 인터넷 연결 유지"
Write-Host "   - 검은 창(서버) 닫지 말 것"
Write-Host ""
