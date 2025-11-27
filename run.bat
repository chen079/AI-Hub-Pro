@echo off
setlocal enabledelayedexpansion

title AI Hub Pro Launcher
color 0B

echo ========================================================
echo                 AI Hub Pro 启动程序
echo ========================================================
echo.

:: [1/5] 检查Python安装
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

:: [2/5] 检查虚拟环境
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

:: [3/5] 激活虚拟环境
echo [3/5] 激活虚拟环境...
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else (
    echo [ERROR] 无法激活虚拟环境
    pause
    exit
)
echo [OK] 虚拟环境激活成功

:: [4/5] 安装依赖
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

:: ==========================================
:: [新增] 环境选择菜单
:: ==========================================
:SELECT_MODE
cls
echo ========================================================
echo                 AI Hub Pro 运行模式选择
echo ========================================================
echo.
echo   [1] 开发模式 (Development)
echo       - Debug 开启 (代码修改后自动重载)
echo       - 仅本机访问 (127.0.0.1)
echo       - 适合调试和开发
echo.
echo   [2] 生产模式 (Production)
echo       - Debug 关闭 (性能更优，更安全)
echo       - 允许局域网访问 (0.0.0.0)
echo       - 适合多人使用
echo.
echo ========================================================
set /p choice="请选择运行模式 (输入 1 或 2): "

if "%choice%"=="1" goto MODE_DEV
if "%choice%"=="2" goto MODE_PROD

echo 输入无效，请重新选择...
timeout /t 2 >nul
goto SELECT_MODE

:MODE_DEV
set "FLASK_ENV=development"
set "HOST_IP=127.0.0.1"
echo.
echo [INFO] 已切换至：开发模式
goto START_APP

:MODE_PROD
set "FLASK_ENV=production"
set "HOST_IP=0.0.0.0"
:: 生成一个简单的随机密钥用于本次会话 (也可以在 app.py 中自动生成)
set "SECRET_KEY=prod_key_%random%%random%%random%"
echo.
echo [INFO] 已切换至：生产模式
echo [INFO] 注意：生产模式下，局域网内的其他设备可通过您的IP地址访问。
goto START_APP

:: ==========================================
:: [5/5] 启动应用
:: ==========================================
:START_APP
echo [5/5] 正在启动 AI Hub Pro...
echo.
echo [INFO] 环境标识: %FLASK_ENV%
echo [INFO] 服务地址: http://localhost:5000
echo.
echo 请不要关闭此窗口，按 Ctrl+C 停止服务...
echo ========================================================

:: 延迟 3 秒打开浏览器
timeout /t 3 /nobreak >nul
start http://localhost:5000

:: 启动 Python 程序
python app.py

pause