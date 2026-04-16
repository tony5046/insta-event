@echo off
chcp 65001 > nul
title 인스타 자동 업로드 - 최초 설치
cd /d "%~dp0"

echo.
echo ========================================
echo   인스타 자동 업로드 - 최초 설치
echo ========================================
echo.

:: Node.js 설치 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js가 설치되어 있지 않습니다!
    echo.
    echo    아래 사이트에서 Node.js를 먼저 설치해주세요:
    echo    https://nodejs.org/ko
    echo.
    echo    "LTS" 버전 다운로드 → 설치 → 컴퓨터 재부팅
    echo    → 이 파일을 다시 실행해주세요
    echo.
    pause
    exit /b 1
)

echo ✅ Node.js 발견:
node --version
echo.

:: npm install
echo 패키지 설치 중... (인터넷 연결 필요)
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ❌ 패키지 설치 실패! 인터넷 연결을 확인해주세요.
    pause
    exit /b 1
)

echo.
echo ✅ 패키지 설치 완료!
echo.

:: auto-images 폴더 생성
if not exist "auto-images" (
    mkdir "auto-images"
    echo ✅ auto-images 폴더 생성됨
) else (
    echo ✅ auto-images 폴더 이미 있음
)

:: uploads 폴더 생성
if not exist "uploads" (
    mkdir "uploads"
    echo ✅ uploads 폴더 생성됨
)

:: auto-accounts.json 초기화 (없을 때만)
if not exist "auto-accounts.json" (
    echo [] > "auto-accounts.json"
    echo ✅ auto-accounts.json 생성됨
)

echo.
echo ========================================
echo   ✅ 설치 완료!
echo ========================================
echo.
echo   다음 단계:
echo     1. "서버_시작.bat" 더블클릭
echo     2. 크롬에서 http://localhost:3000/auto.html 열기
echo     3. 계정 등록 + 이미지 넣기
echo.
pause
