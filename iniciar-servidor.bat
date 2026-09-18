@echo off
title Artistas App - servidor
cd /d "%~dp0"
echo Iniciando Artistas App...
echo.

set "NODECMD=%~dp0node-portable\node-v22.17.0-win-x64\node.exe"
set "NPMCMD=%~dp0node-portable\node-v22.17.0-win-x64\npm.cmd"
if not exist "%NODECMD%" goto SINNODE
goto HAYNODE

:SINNODE
where node >nul 2>nul
if %errorlevel%==0 goto NODENPATH
echo NO se encuentra node 22.
echo Descomprime node-v22.17.0-win-x64.zip en node-portable junto a esta carpeta.
echo Ver COMPANEROS.md punto 1.
pause
exit /b 1

:NODENPATH
echo Usando node del PATH.
set "NODECMD=node"
set "NPMCMD=npm"

:HAYNODE
if exist "node_modules" goto HAYMODULOS
echo Instalando dependencias, solo la primera vez...
call "%NPMCMD%" install --no-audit --no-fund >> arranque.log 2>&1
if %errorlevel% neq 0 goto FALLOINSTALAR

:HAYMODULOS
if exist "firebase-key.json" goto HAYKEY
echo AVISO: falta firebase-key.json, pideselo a un companero por Teams.
echo La app arrancara en modo local sin Firestore.

:HAYKEY
if exist "secrets.json" goto HAYSECRET
echo AVISO: falta secrets.json, pideselo a un companero por Teams.
echo El login con captcha no funcionara hasta tenerlo.

:HAYSECRET
echo.
echo Deja esta ventana ABIERTA y abre http://localhost:8080 en el navegador.
echo Para detener el servidor, cierra esta ventana o pulsa Ctrl+C.
echo Los mensajes quedan en arranque.log.
echo.
"%NODECMD%" server.js >> arranque.log 2>&1
echo El servidor termino, revisa arranque.log.
pause
exit /b 0

:FALLOINSTALAR
echo Fallo npm install. Revisa arranque.log.
pause
exit /b 1
