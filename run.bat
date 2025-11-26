@echo off
setlocal enabledelayedexpansion

:: 设置窗口标题
title AI Hub Pro Launcher

:: 颜色设置 (青色)
color 0B

echo ========================================================
echo                 AI Hub Pro 启动程序
echo ========================================================
echo.

:: 1. 检查 Python 是否安装
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未检测到 Python，请先安装 Python 3.8+ 并添加到环境变量。
    echo.
    pause
    exit
)

:: 2. 检查虚拟环境，不存在则创建
if not exist "venv" (
    echo [INFO] 正在创建虚拟环境 (首次运行可能需要几分钟)...
    python -m venv venv
    if !errorlevel! neq 0 (
        echo [ERROR] 创建虚拟环境失败。
        pause
        exit
    )
    echo [INFO] 虚拟环境创建成功。
) else (
    echo [INFO] 检测到现有虚拟环境。
)

:: 3. 激活虚拟环境
call venv\Scripts\activate

:: 4. 安装/检查依赖
echo [INFO] 正在检查并安装依赖...
pip install -r requirements.txt >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] 依赖安装可能出现问题，尝试显示详细信息重试...
    pip install -r requirements.txt
) else (
    echo [INFO] 依赖环境就绪。
)

:: 5. 启动服务
echo.
echo [SUCCESS] 系统启动中...
echo [INFO] 服务地址: http://127.0.0.1:5000
echo.
echo 请不要关闭此窗口。按下 Ctrl+C 可停止服务。
echo ========================================================

:: 自动打开浏览器 (等待2秒让Flask先启动)
timeout /t 2 /nobreak >nul
start http://127.0.0.1:5000

:: 运行 Flask 应用
python app.py

pause