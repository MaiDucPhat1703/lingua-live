@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3.11 -m venv .venv
  if errorlevel 1 (
    echo Hay cai Python 3.11 tu python.org, roi mo lai tep nay.
    pause
    exit /b 1
  )
)
.venv\Scripts\python.exe -m pip install -r server\requirements.txt
if errorlevel 1 (
  echo Cai thu vien chua thanh cong. Xem loi o tren.
  pause
  exit /b 1
)
echo Mo http://127.0.0.1:8765 tren Chrome. Giu cua so nay mo.
start "" http://127.0.0.1:8765
.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --no-access-log
pause
