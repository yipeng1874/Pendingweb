@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ===== CONFIG =====
set DB_HOST=localhost
set DB_PORT=3306
set DB_USER=root
set DB_PASS=admin8888
set DB_NAME=anchor_todo
set MYSQL_BIN=C:\Program Files\MySQL\MySQL Server 8.0\bin
set UPLOADS_SRC=D:\Pendingweb\backend\uploads
set D_DB_DIR=D:\Pendingweb-back-maysql\db-backups
set D_UP_DIR=D:\Pendingweb-back-maysql\uploads-backups
set C_DB_DIR=C:\Pendingweb-back-maysql\db-backups
set C_UP_DIR=C:\Pendingweb-back-maysql\uploads-backups
set LOGFILE=C:\Pendingweb-back-maysql\backup.log
set KEEP_COUNT=7

:: ===== TIMESTAMP =====
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmm"') do set TIMESTAMP=%%T
set SQL_FILENAME=%DB_NAME%_%TIMESTAMP%.sql

:: ===== CREATE DIRS =====
if not exist "D:\Pendingweb-back-maysql" mkdir "D:\Pendingweb-back-maysql"
if not exist "C:\Pendingweb-back-maysql" mkdir "C:\Pendingweb-back-maysql"
if not exist "%D_DB_DIR%" mkdir "%D_DB_DIR%"
if not exist "%D_UP_DIR%" mkdir "%D_UP_DIR%"
if not exist "%C_DB_DIR%" mkdir "%C_DB_DIR%"
if not exist "%C_UP_DIR%" mkdir "%C_UP_DIR%"

echo. >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"
echo [%TIMESTAMP%] Backup started >> "%LOGFILE%"

:: ===== STEP1: mysqldump to D drive =====
echo [%TIMESTAMP%] [1/4] Exporting database... >> "%LOGFILE%"
"%MYSQL_BIN%\mysqldump.exe" -h %DB_HOST% -P %DB_PORT% -u %DB_USER% -p%DB_PASS% --single-transaction --routines --triggers %DB_NAME% > "%D_DB_DIR%\%SQL_FILENAME%" 2>nul
set DUMP_ERR=%errorlevel%
if %DUMP_ERR% equ 0 (
    echo [%TIMESTAMP%] [1/4] DB export OK: %SQL_FILENAME% >> "%LOGFILE%"
) else (
    echo [%TIMESTAMP%] [ERROR] DB export FAILED, code=%DUMP_ERR% >> "%LOGFILE%"
    del "%D_DB_DIR%\%SQL_FILENAME%" 2>nul
    goto :cleanup
)

:: ===== STEP2: Copy SQL to C drive =====
copy /Y "%D_DB_DIR%\%SQL_FILENAME%" "%C_DB_DIR%\%SQL_FILENAME%" >nul
if %errorlevel% equ 0 (
    echo [%TIMESTAMP%] [2/4] Copy to C drive OK >> "%LOGFILE%"
) else (
    echo [%TIMESTAMP%] [WARN] Copy to C drive FAILED >> "%LOGFILE%"
)

:: ===== STEP3: Sync uploads to D drive =====
echo [%TIMESTAMP%] [3/4] Syncing uploads to D drive... >> "%LOGFILE%"
robocopy "%UPLOADS_SRC%" "%D_UP_DIR%" /MIR /R:3 /W:5 /LOG+:"%LOGFILE%" /NP >nul
echo [%TIMESTAMP%] [3/4] uploads sync to D drive done >> "%LOGFILE%"

:: ===== STEP4: Sync uploads to C drive =====
echo [%TIMESTAMP%] [4/4] Syncing uploads to C drive... >> "%LOGFILE%"
robocopy "%UPLOADS_SRC%" "%C_UP_DIR%" /MIR /R:3 /W:5 /LOG+:"%LOGFILE%" /NP >nul
echo [%TIMESTAMP%] [4/4] uploads sync to C drive done >> "%LOGFILE%"

:: ===== CLEANUP: Keep only latest 7 SQL on D drive =====
:cleanup
echo [%TIMESTAMP%] Cleaning old backups... >> "%LOGFILE%"
for /f "skip=%KEEP_COUNT% delims=" %%F in ('dir /b /o-d "%D_DB_DIR%\*.sql" 2^>nul') do (
    del "%D_DB_DIR%\%%F" >nul
    echo [%TIMESTAMP%] Deleted old backup (D): %%F >> "%LOGFILE%"
)

:: ===== CLEANUP: Keep only latest 7 SQL on C drive =====
for /f "skip=%KEEP_COUNT% delims=" %%F in ('dir /b /o-d "%C_DB_DIR%\*.sql" 2^>nul') do (
    del "%C_DB_DIR%\%%F" >nul
    echo [%TIMESTAMP%] Deleted old backup (C): %%F >> "%LOGFILE%"
)

echo [%TIMESTAMP%] Backup completed successfully >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"

endlocal
exit /b 0
