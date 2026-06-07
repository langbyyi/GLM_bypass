@echo off
chcp 65001 >nul 2>nul

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found, please install Python 3.8+
    pause
    exit /b 1
)

echo [1/2] Installing dependencies...
pip install -r requirements.txt -q 2>nul

echo [2/2] Starting captcha server...
echo.
python captcha_server.py --host 127.0.0.1 --port 8888
pause
