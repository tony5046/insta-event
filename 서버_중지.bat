@echo off
chcp 65001 > nul
title 서버 중지
echo.
echo ========================================
echo   돌아가고 있는 서버를 찾아서 중지합니다...
echo ========================================
echo.
for /f "tokens=5" %%a in ('netstat -aon ^| find "LISTENING" ^| find ":3000"') do (
  echo 포트 3000에서 실행 중인 프로세스 발견 (PID: %%a)
  taskkill /F /PID %%a
  echo 중지 완료!
)
echo.
pause
