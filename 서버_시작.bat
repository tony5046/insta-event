@echo off
chcp 65001 > nul
title 인스타 자동 업로드 서버
cd /d "%~dp0"

:: Node.js 체크
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js가 설치되어 있지 않습니다!
    echo    "최초_설치.bat"을 먼저 실행해주세요.
    pause
    exit /b 1
)

:: node_modules 체크
if not exist "node_modules" (
    echo ❌ 패키지가 설치되어 있지 않습니다!
    echo    "최초_설치.bat"을 먼저 실행해주세요.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   인스타 자동 업로드 서버 시작
echo ========================================
echo.
echo  ※ 이 창을 닫으면 서버가 꺼집니다!
echo  ※ 절대 닫지 말고 최소화만 하세요.
echo.
echo  브라우저에서 열기:
echo    http://localhost:3000/auto.html
echo.
echo ========================================
echo.
node server.js
echo.
echo ========================================
echo   서버가 종료되었습니다.
echo   다시 시작하려면 이 파일을 더블클릭하세요.
echo ========================================
pause
