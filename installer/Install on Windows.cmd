@echo off
rem Installs Skyrim Modding Tools - MCP Server, or updates it: install-windows.ps1 beside this file does the work.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
echo.
pause
