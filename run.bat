@echo off
setlocal enabledelayedexpansion

title AI Hub Pro Launcher
color 0B

echo ========================================================
echo                 AI Hub Pro 启动程序
echo ========================================================
echo.

:: 详细错误检查
echo [1/5] 检查Python安装...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未检测到Python，请:
    echo   1. 安装Python 3.8+
    echo   2. 安装时勾选 "Add Python to PATH"
    echo   3. 重新运行此脚本
    echo.
    pause
    exit
)
echo [OK] Python检测成功

:: 检查并创建虚拟环境
echo [2/5] 检查虚拟环境...
if not exist "venv" (
    echo [INFO] 正在创建虚拟环境...
    python -m venv venv
    if !errorlevel! neq 0 (
        echo [ERROR] 虚拟环境创建失败
        echo 尝试使用: python -m venv --without-pip venv
        pause
        exit
    )
    echo [OK] 虚拟环境创建成功
) else (
    echo [OK] 虚拟环境已存在
)

:: 激活虚拟环境
echo [3/5] 激活虚拟环境...
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else (
    echo [ERROR] 无法激活虚拟环境
    pause
    exit
)
echo [OK] 虚拟环境激活成功

:: 安装依赖
echo [4/5] 安装依赖包...
if exist "requirements.txt" (
    pip install -r requirements.txt
    if !errorlevel! neq 0 (
        echo [WARNING] 依赖安装遇到问题
        echo 尝试继续启动...
    )
) else (
    echo [WARNING] 未找到requirements.txt文件
)
echo [OK] 依赖检查完成

:: 启动应用
echo [5/5] 启动AI Hub Pro...
echo.
echo [INFO] 服务地址: http://127.0.0.1:5000
echo 请不要关闭此窗口，按Ctrl+C停止服务
echo ========================================================

timeout /t 3 /nobreak >nul
start http://127.0.0.1:5000

python app.py

pause