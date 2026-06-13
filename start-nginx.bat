@echo off

chcp 65001 >nul

setlocal



set "NGINX_DIR=C:\nginx-1.30.2"

set "NGINX_EXE=%NGINX_DIR%\nginx.exe"



if not exist "%NGINX_EXE%" (

  echo 未找到 nginx.exe：%NGINX_EXE%

  echo 请先确认 Nginx 安装目录是否正确。

  pause

  exit /b 1

)



echo ========================================

echo 启动 Nginx

echo ========================================

echo Nginx 目录：%NGINX_DIR%

echo.



cd /d "%NGINX_DIR%"



%NGINX_EXE% -t

if errorlevel 1 (

  echo.

  echo Nginx 配置检查失败，请先修复 nginx.conf。

  pause

  exit /b 1

)



%NGINX_EXE% -s reload >nul 2>nul

if errorlevel 1 (

  echo 检测到 Nginx 未运行，正在直接启动...

  start "Nginx" "%NGINX_EXE%"

) else (

  echo Nginx 已运行，已执行 reload。

)



echo.

echo 访问地址：

echo - PC:  http://localhost:8088/

echo - H5:  http://localhost:8081/

echo.

pause

endlocal

