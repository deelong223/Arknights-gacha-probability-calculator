@echo off
REM Rebuild gacha.wasm (wrapper so you do not have to fight the execution policy)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
