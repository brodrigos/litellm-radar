@echo off
setlocal
title Brodrigos Dashboard + LiteLLM Radar
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nao encontrado no PATH.
  echo   Instale em https://nodejs.org e tente novamente.
  echo.
  pause
  exit /b 1
)

echo.
echo   Iniciando o LiteLLM Server Radar (porta 3333)...
start /b cmd /c "cd /d "%~dp0..\litellm-radar" && node ../litellm-radar-server.js"

echo.
echo   Iniciando o Brodrigos Dashboard...
echo   Feche esta janela para encerrar os servidores.
echo.

node server.mjs %*

if errorlevel 1 (
  echo.
  echo   O servidor encerrou com erro.
  pause
)
endlocal
