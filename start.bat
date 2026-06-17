@echo off
REM ============================================================
REM  Revision Strike - launch local server + open browser
REM ============================================================
REM  Serves the current folder on http://localhost:8765 and
REM  opens index.html in your default browser. Leave this window
REM  open while you're playing - closing it stops the server.
REM ============================================================

setlocal
set PORT=8765
cd /d "%~dp0"

REM Pick a Python command (python -> py)
set PYCMD=
where python >nul 2>nul && set PYCMD=python
if "%PYCMD%"=="" (
    where py >nul 2>nul && set PYCMD=py
)
if "%PYCMD%"=="" (
    echo.
    echo  [ ERROR ] Python not found on PATH.
    echo  Run install.bat first, or install Python from python.org.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Revision Strike - http://localhost:%PORT%/index.html
echo ============================================================
echo.
echo  Leave this window open while you're playing.
echo  Close it (or press Ctrl+C) to stop the server.
echo.

REM Open the browser shortly after the server starts
start "" "http://localhost:%PORT%/index.html"

REM -m http.server is built into Python 3; no extra installs needed
%PYCMD% -m http.server %PORT%
