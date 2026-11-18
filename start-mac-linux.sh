#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
echo "Mở http://127.0.0.1:8765 bằng trình duyệt và giữ cửa sổ này mở."
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --no-access-log
