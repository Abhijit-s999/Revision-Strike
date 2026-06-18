@echo off
REM ============================================================
REM  Revision Strike - Public tunnel (Cloudflare, no account)
REM ============================================================
REM  Exposes your local server on a public *.trycloudflare.com
REM  URL so a friend anywhere on the internet can join the game.
REM
REM  Cloudflare quick tunnels: no signup, no account, no token.
REM  First run downloads cloudflared.exe (~25 MB) into this folder.
REM
REM  IMPORTANT: run start.bat FIRST in a separate window, then
REM  run this script. The tunnel needs the local server already up.
REM ============================================================

setlocal
set PORT=8765
set CFEXE=%~dp0cloudflared.exe

if exist "%CFEXE%" goto :check_server

echo.
echo  First run - downloading cloudflared (~25 MB, one-time)...
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CFEXE%' -UseBasicParsing } catch { Write-Host $_.Exception.Message; exit 1 }"
if not exist "%CFEXE%" goto :download_failed
echo  [ OK ] cloudflared.exe downloaded.

:check_server
echo.
echo  Checking local server on http://localhost:%PORT% ...
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:%PORT%/index.html' -UseBasicParsing -TimeoutSec 2 } catch { exit 1 }"
if errorlevel 1 goto :no_server
echo  [ OK ] Local server reachable.

echo.
echo ============================================================
echo   Starting Cloudflare Tunnel...
echo ============================================================
echo.
echo  Watch the lines below for a URL like:
echo      https://something-random.trycloudflare.com
echo.
echo  Share that URL with your friend - they open it on their
echo  laptop, you both end up in the lobby together. First one
echo  to load is the host (P1), second is the guest (P2).
echo.
echo  Leave THIS window open while you're playing. Closing it
echo  takes the tunnel down.
echo ============================================================
echo.

"%CFEXE%" tunnel --url http://localhost:%PORT%
goto :eof

:download_failed
echo.
echo  [ ERROR ] Download failed. Check your internet connection,
echo  then re-run this script.
echo.
pause
exit /b 1

:no_server
echo.
echo  [ WARNING ] Nothing answered on http://localhost:%PORT%.
echo.
echo  Open start.bat FIRST in a separate window, wait for the
echo  browser to open, then re-run this script.
echo.
pause
exit /b 1
