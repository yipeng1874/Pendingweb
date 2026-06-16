@echo off
chcp 65001
cd /d D:\Pendingweb\backend
echo === 安装依赖 ===
call npm install
echo === 执行数据库迁移 ===
call npx prisma migrate deploy
echo === 完成 ===
pause
