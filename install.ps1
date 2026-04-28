# install.ps1
# 인스타 자동 업로드 - 다른 노트북 자동 셋업 스크립트
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
    Write-Host "❌ 관리자 권한이 필요합니다!" -ForegroundColor Red
    Write-Host "   PowerShell을 '관리자 권한으로 실행'으로 다시 열어주세요." -ForegroundColor Yellow
    pause
    exit 1
}

# 1. Node.js 설치
Write-Host "[1/7] Node.js 설치 확인..." -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "   ✅ 이미 설치됨: $(node --version)" -ForegroundColor Green
} else {
    Write-Host "   설치 중... (1~2분)"
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
    Write-Host "   ✅ 완료" -ForegroundColor Green
}

# 2. Git 설치
Write-Host "[2/7] Git 설치 확인..." -ForegroundColor Yellow
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "   ✅ 이미 설치됨" -ForegroundColor Green
} else {
    Write-Host "   설치 중... (1~2분)"
    winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
    Write-Host "   ✅ 완료" -ForegroundColor Green
}

# 3. 코드 다운로드
Write-Host "[3/7] 코드 다운로드..." -ForegroundColor Yellow
if (Test-Path $installDir) {
    Write-Host "   기존 폴더 발견, 업데이트 중..."
    Push-Location $installDir
    git pull
    Pop-Location
} else {
    git clone $repoUrl $installDir
}
Write-Host "   ✅ 완료: $installDir" -ForegroundColor Green

# 4. 패키지 설치
Write-Host "[4/7] 패키지 설치 (1~2분)..." -ForegroundColor Yellow
Push-Location $installDir
& npm install --silent 2>&1 | Out-Null
Pop-Location
Write-Host "   ✅ 완료" -ForegroundColor Green

# 5. 깨우기 타이머 활성화
Write-Host "[5/7] 깨우기 타이머 활성화..." -ForegroundColor Yellow
powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
powercfg /SETACTIVE SCHEME_CURRENT | Out-Null
Write-Host "   ✅ 완료" -ForegroundColor Green

# 6. 작업 스케줄러 등록
Write-Host "[6/7] 자동 작업 등록..." -ForegroundColor Yellow

# 부팅 시 자동 시작
$startBat = Join-Path $installDir 'START.bat'
$bootAction = New-ScheduledTaskAction -Execute $startBat
$bootTrigger = New-ScheduledTaskTrigger -AtStartup
$bootSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
Unregister-ScheduledTask -TaskName 'InstaAutoUpload-Boot' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'InstaAutoUpload-Boot' -Action $bootAction -Trigger $bootTrigger -Settings $bootSettings -RunLevel Highest -User $env:USERNAME | Out-Null

# 매일 09:55 자동 깨우기 + 서버 시작
$wakeAction = New-ScheduledTaskAction -Execute $startBat
$wakeTrigger = New-ScheduledTaskTrigger -Daily -At 9:55am
$wakeSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
Unregister-ScheduledTask -TaskName 'InstaAutoUpload-WakeUp' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'InstaAutoUpload-WakeUp' -Action $wakeAction -Trigger $wakeTrigger -Settings $wakeSettings -RunLevel Highest -User $env:USERNAME | Out-Null

# 매일 11:00 자동 sleep
$sleepAction = New-ScheduledTaskAction -Execute 'rundll32.exe' -Argument 'powrprof.dll,SetSuspendState 0,1,0'
$sleepTrigger = New-ScheduledTaskTrigger -Daily -At 11:00am
$sleepSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Unregister-ScheduledTask -TaskName 'InstaAutoUpload-Sleep' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'InstaAutoUpload-Sleep' -Action $sleepAction -Trigger $sleepTrigger -Settings $sleepSettings -RunLevel Highest -User $env:USERNAME | Out-Null

Write-Host "   ✅ 완료" -ForegroundColor Green

# 7. 서버 즉시 시작
Write-Host "[7/7] 서버 시작..." -ForegroundColor Yellow
Start-Process -FilePath $startBat -WorkingDirectory $installDir
Write-Host "   ✅ 완료" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  ✅ 셋업 완료!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "📅 자동 스케줄:" -ForegroundColor Cyan
Write-Host "   매일 09:55 - 자동 깨우기 + 서버 시작"
Write-Host "   매일 10:00 - 인스타 자동 업로드"
Write-Host "   매일 11:00 - 자동 sleep"
Write-Host ""
Write-Host "🌐 브라우저 주소:" -ForegroundColor Cyan
Write-Host "   http://localhost:3000/auto.html"
Write-Host ""
Write-Host "⚠️  주의:" -ForegroundColor Yellow
Write-Host "   - 노트북 충전기 항상 연결!"
Write-Host "   - 절전(sleep) 모드 OK / 완전 종료 NO"
Write-Host "   - 인터넷 연결 유지"
Write-Host ""
