@echo off
setlocal EnableExtensions
REM ============================================================
REM  Nexo Desktop (Electron)
REM  Execute FORA do Cursor
REM ============================================================

cd /d "%~dp0.."

echo.
echo [nexo] 1/3 Instalando dependencias...
call npm install
if errorlevel 1 goto :fail

echo.
echo [nexo] 2/3 Limpeza + build web + instalador...
call npm run desktop:build
if errorlevel 1 goto :fail

echo.
echo [nexo] 3/3 Pronto!
echo.
echo Instalador: %USERPROFILE%\.nexo-build\electron-dist\Nexo-Setup-*.exe
echo (versoes antigas e cache Tauri sao apagados automaticamente)
echo.
echo 1. Instale o Nexo-Setup-*.exe
echo 2. Abra pelo Menu Iniciar
echo.
start "" explorer "%USERPROFILE%\.nexo-build\electron-dist"
pause
exit /b 0

:fail
echo.
echo [nexo] Build falhou.
pause
exit /b 1
