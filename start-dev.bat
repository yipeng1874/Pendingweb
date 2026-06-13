@echo off



chcp 65001 >nul



setlocal



set "SCRIPT_DIR=%~dp0"

if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "PROJECT_DIR=%SCRIPT_DIR%"

set "H5_DIR=%PROJECT_DIR%\todo-h5"



set "BACKEND_PORT=4000"

set "FRONTEND_PORT=5173"

set "FRONTEND_EXTRA_PORT=5174"

set "H5_PORT=4173"

set "H5_EXTRA_PORT=4174"



echo ========================================

echo  主播待办系统 - 启动前端和后端

echo ========================================

echo.

echo 项目目录：%PROJECT_DIR%

echo H5 目录：%H5_DIR%

echo.



if not exist "%PROJECT_DIR%\package.json" (

  echo 未在脚本目录找到 package.json，请确认脚本位于项目根目录。

  echo.

  pause >nul

  exit /b 1

)



if not exist "%H5_DIR%\package.json" (

  echo 未找到 H5 子项目目录：%H5_DIR%

  echo.

  pause >nul

  exit /b 1

)



echo [1/6] 释放后端端口 %BACKEND_PORT% ...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=(Get-NetTCPConnection -LocalPort %BACKEND_PORT% -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique; foreach($id in $ids){ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }"



echo [2/6] 释放前端端口 %FRONTEND_PORT% / %FRONTEND_EXTRA_PORT% ...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=(Get-NetTCPConnection -LocalPort %FRONTEND_PORT%,%FRONTEND_EXTRA_PORT% -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique; foreach($id in $ids){ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }"



echo [3/6] 释放 H5 端口 %H5_PORT% / %H5_EXTRA_PORT% ...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=(Get-NetTCPConnection -LocalPort %H5_PORT%,%H5_EXTRA_PORT% -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique; foreach($id in $ids){ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }"



echo [4/6] 启动后端服务 ...

cd /d "%PROJECT_DIR%"

start "主播待办系统-后端 4000" cmd /k "cd /d ""%PROJECT_DIR%"" && npm run dev -w backend"



echo [5/6] 等待后端健康检查通过后再启动前端和 H5 ...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(30); do { try { $resp=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%BACKEND_PORT%/api/health -TimeoutSec 2; if($resp.StatusCode -eq 200){ exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while((Get-Date) -lt $deadline); exit 1"

if errorlevel 1 (

  echo.

  echo 后端健康检查未通过，已取消启动前端和 H5。

  echo 请先检查后端窗口日志。

  echo.

  pause >nul

  exit /b 1

)



echo [6/6] 启动前端和 H5 ...

start "主播待办系统-前端 5173" cmd /k "cd /d ""%PROJECT_DIR%"" && npm run dev -w frontend"

start "主播待办系统-H5 4173" cmd /k "cd /d ""%H5_DIR%"" && npm run dev"



echo.

echo 已启动三个窗口：

echo - 后端：http://localhost:4000

echo - 前端：http://localhost:5173

echo - H5：http://localhost:4173

echo.

echo 当前已启用 strictPort；如果端口被占用，服务会直接报错，不会偷偷切到 5174 / 4174。

echo 如果浏览器没有自动打开，请手动访问 http://localhost:5173 或 http://localhost:4173

start http://localhost:5173



echo.

echo 按任意键退出脚本窗口。

pause >nul



endlocal

