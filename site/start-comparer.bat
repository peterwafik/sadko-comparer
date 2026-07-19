@echo off
title SADKO Comparer Engine
echo ============================================
echo   SADKO price-comparer engine
echo   Keep THIS window open while you test.
echo   Open http://localhost:8082 in your browser.
echo   Close this window to stop the engine.
echo ============================================
echo.
cd /d "%~dp0"
rem .env carries NVIDIA_API_KEY (AI layer). Missing file is fine — the engine
rem then runs fully rule-based, exactly as before.
node --env-file-if-exists=.env compare-server.mjs
echo.
echo (engine stopped)
pause
