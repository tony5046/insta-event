@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo 🎯 인스타 이벤트 추첨 도구
echo ================================
echo.

REM Node.js 설치 확인
where node >nul 2>&1
if errorlevel 1 (
  echo ❌ Node.js가 설치되어 있지 않습니다.
  echo    https://nodejs.org 에서 LTS 버전을 다운로드 후 설치해주세요.
  pause
  exit /b
)

REM 패키지 설치
if not exist node_modules (
  echo 📦 라이브러리 설치 중...
  call npm install --silent
)

REM 계정 자동 등록 (최초 1회)
if not exist accounts.json (
  if exist default-accounts.json (
    copy "default-accounts.json" accounts.json >nul
    echo ✅ 계정 5개 자동 등록 완료
  )
)

REM 3초 후 브라우저 자동 열기
start "" /min cmd /c "timeout /t 3 >nul && start http://localhost:3000"

echo.
echo ✅ 준비 완료! 브라우저가 자동으로 열립니다.
echo    끄려면 이 창 닫거나 Ctrl+C
echo.
node server.js
pause
