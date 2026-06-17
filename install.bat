@echo off
REM ============================================================
REM  Revision Strike - Install / dependency check
REM ============================================================
REM  The game runs entirely in your browser. The only thing we
REM  need locally is a tiny web server, and Python ships with
REM  one (python -m http.server). This script checks Python is
REM  installed and points you to the download page if it isn't.
REM ============================================================

setlocal enabledelayedexpansion
echo.
echo ============================================================
echo   Revision Strike - dependency check
echo ============================================================
echo.

REM Check for Python (python.exe in PATH)
where python >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYV=%%v
    echo  [ OK ] Python !PYV! found
    echo.
    echo  You're ready to play. Double-click start.bat to launch the game.
    echo.
    pause
    exit /b 0
)

REM Try `py` launcher (Windows Python installer ships this)
where py >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=2" %%v in ('py --version 2^>^&1') do set PYV=%%v
    echo  [ OK ] Python !PYV! found (via 'py' launcher)
    echo.
    echo  You're ready to play. Double-click start.bat to launch the game.
    echo.
    pause
    exit /b 0
)

echo  [ MISSING ] Python is not installed (or not on PATH).
echo.
echo  Revision Strike needs Python to serve the game files locally.
echo  Download the latest installer from:
echo.
echo      https://www.python.org/downloads/
echo.
echo  IMPORTANT: on the first installer screen, tick the box that says
echo  "Add python.exe to PATH" before clicking Install.
echo.
echo  Once installed, re-run this script.
echo.
pause
exit /b 1
