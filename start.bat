@echo off
chcp 65001 >nul
echo ========================================
echo   인스타 이벤트 서버 + ngrok 시작
echo ========================================
echo.

cd /d "%~dp0"

:: 서버 시작 (백그라운드)
start "insta-event-server" /min cmd /c "node server.js"
echo [1/2] 서버 시작 완료 (localhost:3000)

:: 잠시 대기 후 ngrok 시작
timeout /t 2 /nobreak >nul
start "ngrok" /min cmd /c "ngrok http 3000"
echo [2/2] ngrok 시작 완료

echo.
echo ========================================
echo   모두 시작되었습니다!
echo   - 로컬: http://localhost:3000
echo   - 외부: ngrok 창에서 URL 확인
echo ========================================
echo.
echo 이 창을 닫아도 서버는 계속 실행됩니다.
echo 종료하려면 작업표시줄에서 서버/ngrok 창을 닫으세요.
pause
