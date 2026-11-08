@echo off
REM Arranca IPSC Track en http://localhost:8080 y abre el navegador
cd /d "%~dp0"
start "" http://localhost:8080
python server.py 8080
