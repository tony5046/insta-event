@echo off
cd /d "%~dp0"
echo Starting server...
echo.
node server.js
echo.
echo Server stopped.
pause
