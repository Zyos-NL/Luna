@echo off
REM Luna launcher — boots ComfyUI (port 18190) + Angular dev server + opens the browser.
REM Place a shortcut to this file on your desktop or pin it to the taskbar.

REM Ensure Docker container is running (port 18190)
docker compose -f "%~dp0infra\docker-compose.yml" up -d

REM Open the frontend in default browser
start "" "http://localhost:4200"

REM Start the Angular dev stack in this window. Closing this window stops ng serve.
cd /d "%~dp0apps\web"
call npm start
