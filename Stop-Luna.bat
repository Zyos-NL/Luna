@echo off
REM Stops the luna-comfyui container so Lumi (port 18188) can claim the GPU again.

docker compose -f "%~dp0infra\docker-compose.yml" down

echo.
echo Luna ComfyUI stopped. GPU released.
pause
