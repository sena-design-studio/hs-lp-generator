@echo off
REM Double-click this file in Explorer to update the LP Generator.
REM Mirrors "Update LP Generator.command" on macOS.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
