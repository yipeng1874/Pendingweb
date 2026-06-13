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

echo  主播待办系统 - 停止前端和后端

echo ========================================

echo.

echo 项目目录：%PROJECT_DIR%

echo H5 目录：%H5_DIR%

echo.



echo [1/3] 停止后端端口 %BACKEND_PORT% ...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=(Get-NetTCPConnection -LocalPort %BACKEND_PORT% -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique; if($ids){ foreach($id in $ids){ Write-Host ('Stopping PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } } else { Write-Host 'No process found.' }"



echo [2/3] 停止前端端口 %FRONTEND_PORT% / %FRONTEND_EXTRA_PORT% ...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=(Get-NetTCPConnection -LocalPort %FRONTEND_PORT%,%FRONTEND_EXTRA_PORT% -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique; if($ids){ foreach($id in $ids){ Write-Host ('Stopping PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } } else { Write-Host 'No process found.' }"



echo [3/3] 停止 H5 端口 %H5_PORT% / %H5_EXTRA_PORT% ...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=(Get-NetTCPConnection -LocalPort %H5_PORT%,%H5_EXTRA_PORT% -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique; if($ids){ foreach($id in $ids){ Write-Host ('Stopping PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } } else { Write-Host 'No process found.' }"



echo.

echo 前端、后端和 H5 已停止。

echo.

echo 按任意键退出脚本窗口。

pause >nul



endlocal

