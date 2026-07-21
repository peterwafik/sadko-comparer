@echo off
title SADKO Comparer Engine
echo ============================================
echo   SADKO price-comparer engine
echo.
echo   Open:  http://localhost:8082/compare.html
echo.
echo   Keep THIS window open while you test.
echo   Close this window to stop the engine.
echo ============================================
echo.
cd /d "%~dp0"
if exist "data\catalog.db" (
  echo [catalog] data\catalog.db found - searches answer from the crawled catalog.
) else (
  echo [catalog] no data\catalog.db yet - falling back to live store search.
  echo           To build the catalog, run from the SADKO folder:
  echo             node scripts\crawl-m1.mjs --max 60
)
echo.
rem .env carries NVIDIA_API_KEY (AI layer). Missing file is fine — the engine
rem then runs fully rule-based, exactly as before.
node --env-file-if-exists=.env compare-server.mjs
echo.
echo (engine stopped)
pause
