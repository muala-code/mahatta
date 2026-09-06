@echo off
chcp 65001 >nul
cd /d "%~dp0"
py server.py 2>nul
if errorlevel 1 python server.py
pause
