@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Radar Play
set PY=
where python >nul 2>nul && set PY=python
if not defined PY ( where py >nul 2>nul && set PY=py )
if defined PY (
  echo.
  echo  Radar Play arrancando...
  echo  Para usar el iPhone como mando: iPhone y PC en la misma WiFi,
  echo  y en Radar Play ve a Ajustes ^> Mando desde tu iPhone y escanea el QR.
  echo  Si Windows pregunta por el Firewall, marca "Redes privadas" y pulsa Permitir.
  echo.
  %PY% puente.py
) else (
  echo Python no esta instalado: arranco sin OBD-II ni mando del iPhone.
  echo Instalalo desde python.org marcando "Add python.exe to PATH" para tenerlo todo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
)
pause
