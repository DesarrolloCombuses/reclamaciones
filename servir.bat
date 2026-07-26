@echo off
REM Levanta la app en http://localhost:8000
cd /d "%~dp0"
echo.
echo   Reclamaciones en contra
echo   ------------------------------------------
echo   Abre:  http://localhost:8000
echo   Para detener el servidor: Ctrl+C
echo.
start "" http://localhost:8000
python -m http.server 8000
