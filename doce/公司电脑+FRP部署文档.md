# 公司电脑 + FRP 部署文档

## 1. 文档目标

本文档用于指导当前 `D:\Pendingweb` 项目部署到公司电脑，并通过固定 FRP 地址提供对外访问。

适用场景：

- 没有公网 IP
- 企业内部使用
- 公司电脑作为长期运行服务器
- FRP 地址固定不变
- 后续仅做版本更新与日常维护

本文档覆盖：

1. 需要安装哪些软件
2. 需要准备哪些环境
3. 项目应如何放置
4. 前后端如何构建与启动
5. Nginx 和 FRP 如何配合
6. 首次部署的完整步骤
7. 上线后的检查项

---

## 2. 当前项目结构说明

当前项目主要包含三个部分：

1. `backend`：Node.js + Express + Prisma + MySQL 的后端服务
2. `frontend`：PC 前端
3. `todo-h5`：H5 前端

上线后推荐结构是：

- 后端常驻运行
- PC 前端使用构建产物 `frontend/dist`
- H5 使用构建产物 `todo-h5/dist`
- Nginx 提供静态资源和反向代理
- FRP 提供固定访问入口

---

## 3. 公司电脑需要安装的软件

## 3.1 必装软件

### 1. Git

用途：

- 从仓库拉代码
- 后续执行 `git pull` 更新项目

建议：安装最新版稳定版 Git for Windows。

### 2. Node.js

用途：

- 安装依赖
- 构建前端和后端
- 运行后端服务

建议版本：

- Node.js 18 LTS 或 20 LTS

建议同时确认：

- `node -v`
- `npm -v`

可正常执行。

### 3. MySQL

用途：

- 项目主数据库

建议版本：

- MySQL 8.x

建议安装后：

- 创建正式数据库
- 创建专用业务账号
- 不建议长期直接使用 root 跑业务

### 4. Redis

用途：

- 项目 Redis 能力支持

建议版本：

- Redis 6.x 或 7.x

如果当前业务依赖较轻，也建议装好并保持服务可用。

### 5. Nginx

用途：

- 提供 PC 前端静态访问
- 提供 H5 静态访问
- `/api` 代理到后端
- `/uploads` 暴露上传文件
- 开启 gzip 与缓存

建议版本：

- Windows 可用稳定版 Nginx

### 6. PM2

用途：

- 让后端服务常驻运行
- 服务异常时自动拉起
- 后续重启更方便

安装方式：

```bash
npm install -g pm2
```

---

## 3.2 建议安装的软件

### 1. HeidiSQL / Navicat / DBeaver

用途：

- 查看和维护 MySQL 数据库

### 2. Everything

用途：

- 快速搜索服务器文件

### 3. 7-Zip

用途：

- 解压 Nginx、FRP 等工具

### 4. Windows 服务管理辅助工具（可选）

如果后续要把某些服务做成系统服务，可按运维习惯再补充。

---

## 4. 环境准备

## 4.1 操作系统建议

建议：

- Windows 10 / Windows 11 专用电脑
- 尽量专机专用，不作为普通办公主机频繁折腾

建议关闭或调整：

- 自动睡眠
- 自动休眠
- 长时间无人操作自动断网
- 非必要的系统自动重启

---

## 4.2 目录建议

建议在公司电脑上统一放到固定目录，例如：

```text
C:\deploy
├─ source            # 项目源码
├─ pc-web            # PC 前端 dist
├─ h5-web            # H5 dist
├─ backend           # 后端运行目录
├─ uploads           # 上传文件目录
└─ nginx             # Nginx 安装目录（如果你选择放这里）
```

也可以使用你现在熟悉的项目目录结构，但建议部署目录和源码目录尽量分开。

---

## 4.3 网络与 FRP

需要确认：

1. FRP 地址固定不变
2. FRP 已经可以分别转发到公司电脑的 PC Nginx 与 H5 Nginx 监听端口
3. 飞书回调地址最终使用固定 FRP 地址
4. 公司电脑长期联网稳定

---

## 5. 项目需要的环境变量

## 5.1 后端

参考：

- `backend/.env.example`

正式环境至少要准备：

- `PORT`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `DATABASE_URL`
- `REDIS_URL`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_REDIRECT_URI`

注意：

- 正式环境不要再使用开发密钥
- `JWT_SECRET` 必须替换为真正安全的值
- 建议同时配置：
  - `FEISHU_REDIRECT_URI_PC`
  - `FEISHU_REDIRECT_URI_H5`
- 当前推荐：
  - `FEISHU_REDIRECT_URI_PC=http://frp7.ccszxc.site:29266/pc/auth/callback`
  - `FEISHU_REDIRECT_URI_H5=http://frp7.ccszxc.site:29267/auth/callback`

---

## 5.2 前端 / H5

参考：

- `frontend/.env.example`
- `todo-h5/.env.example`

前端一般只需要公开级变量，例如：

- `VITE_FEISHU_APP_ID`

不要把后端密钥放在前端环境变量中。

---

## 6. 首次部署前建议准备

部署前建议先准备：

1. Git 仓库地址
2. 公司电脑上的项目目录
3. MySQL 数据库与账号
4. Redis 可用地址
5. 飞书正式应用配置
6. FRP 已固定好访问地址
7. Nginx 已安装
8. PM2 已安装

---

## 7. 首次部署步骤

## 7.1 拉取项目代码

在公司电脑目标目录执行：

```bash
git clone <你的仓库地址> source
```

后续进入：

```bash
cd source
```

---

## 7.2 安装依赖

### 根目录依赖

```bash
npm install
```

### H5 依赖

如果 H5 不是 workspace 管理的一部分，进入 H5 目录安装：

```bash
cd todo-h5
npm install
cd ..
```

---

## 7.3 配置正式环境变量

### 后端

在：

- `backend/.env`

或你们约定的正式环境文件中填写正式配置。

### 前端 / H5

根据需要填写公开变量。

---

## 7.4 准备数据库

### 1. 创建数据库

例如：

- `anchor_todo`

### 2. 执行 Prisma 相关操作

如果当前项目已有 migration，请按项目当前实践执行。

如果当前主要依赖 `prisma db push` 或初始化脚本，也要按现有项目方式处理。

### 3. 必要时导入基础数据

包括：

- 角色/权限
- 组织结构
- 账号数据
- 飞书配置数据

---

## 7.5 构建项目

### 1. 构建后端

```bash
npm run build -w backend
```

### 2. 构建 PC 前端

```bash
npm run build -w frontend
```

### 3. 构建 H5

```bash
cd todo-h5
npm run build
cd ..
```

---

## 7.6 准备部署目录

建议把构建结果复制到部署目录，例如：

### PC

- `source/frontend/dist/*` → `C:/deploy/pc-web/`

### H5

- `source/todo-h5/dist/*` → `C:/deploy/h5-web/`

### 后端

可以直接在 `source/backend` 内运行，也可以把后端构建产物复制到单独目录。

如果希望更整洁，建议：

- `source/backend/dist`
- `source/backend/prisma`
- `source/backend/package.json`
- `source/backend/.env`

复制到：

- `C:/deploy/backend/`

---

## 7.7 准备上传目录

确保上传目录存在，例如：

```text
C:\deploy\uploads\tasks
```

并确保后端运行账号有写权限。

---

## 7.8 配置 Nginx

建议使用你现有文档：

- `doce/nginx-本机与公司电脑通用示例配置.md`

主要完成：

1. PC 静态站点指向 `pc-web`
2. H5 指向 `h5-web`
3. `/api` 代理到后端 `4000`
4. `/uploads` 指向上传目录
5. 开启 gzip
6. 配置缓存
7. 配置前端路由回退

配置完成后执行：

```bash
nginx -s reload
```

---

## 7.9 使用 PM2 启动后端

如果后端运行目录为 `C:/deploy/backend`，进入该目录后执行：

```bash
pm2 start dist/server.js --name anchor-todo-api
```

查看状态：

```bash
pm2 list
```

查看日志：

```bash
pm2 logs anchor-todo-api
```

---

## 8. 首次部署完成后的检查项

## 8.1 服务检查

确认：

1. 后端健康检查正常
2. PC 页面能打开
3. H5 页面能打开
4. 页面刷新子路由不 404
5. 图片上传后可访问
6. 飞书登录回调正常

---

## 8.2 功能检查

建议至少检查：

### 登录与身份

- 手机号密码登录
- 飞书登录
- 身份切换

### PC

- 组织管理
- 账号管理
- 主播管理
- 待办任务看板
- 提醒页面

### H5

- 登录
- 身份选择
- 待办列表
- 详情页
- 个人提醒
- 图片上传

---

## 8.3 性能检查

确认：

- Nginx 已开启 gzip
- 静态资源缓存正常
- 首屏访问明显优于 Vite 开发模式

---

## 9. 后续维护建议

### 1. 数据备份

至少定期备份：

- MySQL 数据库
- 上传目录 `uploads/tasks`

### 2. 服务稳定性

建议：

- 公司电脑禁用自动睡眠
- Nginx 与 PM2 保持常驻
- FRP 保持稳定运行

### 3. 配置管理

正式环境的：

- `.env`
- Nginx 配置
- FRP 配置

建议留档并统一保存。

---

## 10. 最终建议

对于你们现在的场景，推荐长期方案是：

1. 开发电脑负责编码和测试
2. Git 推送源码
3. 公司电脑负责拉取、构建、部署
4. Nginx 提供静态资源与 API 代理
5. PM2 守护后端
6. FRP 负责固定入口

这样能在没有公网 IP 的前提下，较稳定地支撑企业内部使用。
