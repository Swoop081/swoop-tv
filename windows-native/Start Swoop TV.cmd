@echo off
setlocal
cd /d "%~dp0"
title Swoop TV Windows Bridge
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0SwoopTV.ps1"
if errorlevel 1 (
  echo.
  echo Swoop TV stopped with an error.
  pause
)
