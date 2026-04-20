@echo off
chcp 65001 > nul
title Insta Auto Upload Server
cd /d "%~dp0"

echo.
echo ========================================
echo   Insta Auto Upload Server
echo ========================================
echo.

:: Node.js check
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    echo Please install from https://nodejs.org/
    pause
    exit /b 1
)

:: node_modules check
if not exist "node_modules" (
    echo [INFO] Installing packages...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

:: Kill existing process on port 3000
echo [INFO] Checking for existing server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "LISTENING" ^| findstr ":3000 "') do (
    echo [INFO] Killing old server (PID %%a)...
    taskkill /F /PID %%a >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo.
echo ========================================
echo   Server starting...
echo ========================================
echo.
echo   DO NOT CLOSE THIS WINDOW!
echo.
echo   Open in browser:
echo     http://localhost:3000/auto.html
echo.
echo ========================================
echo.

node server.js

echo.
echo ========================================
echo   Server stopped.
echo ========================================
pause
