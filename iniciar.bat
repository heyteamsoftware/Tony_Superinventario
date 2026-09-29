@echo off
rem Arranca el Superinventario. Instala las dependencias la primera vez.
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js: descargalo de https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias...
  call npm install --omit=dev || (pause & exit /b 1)
)
rem Abre el navegador cuando el servidor ya este escuchando.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node src\server.js
pause
