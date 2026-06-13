# Pendingweb · 公司组织任务发放与回收待办系统

> 一套面向直播公会的全栈组织管理与任务闭环平台，聚焦组织治理、账号管理与主播任务全生命周期。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-97.7%25-blue)
![React](https://img.shields.io/badge/React-18-61dafb)
![Node.js](https://img.shields.io/badge/Node.js-Express-green)

---

## 界面预览

| 我的待办 · 任务聚合首页 | 协同任务 · 发布模式选择 |
|---|---|
| ![待办首页](./界面截图/09f555e1-e6d1-4fce-9a79-777008613580.png) | ![协同任务](./界面截图/49f873ee-06f2-45d4-bd8b-d1079e08790a.png) |

| 组织管理 · 组织树设立 | 临时任务 · 任务类型选择 |
|---|---|
| ![组织管理](./界面截图/62fbb803-31dd-4d9a-be22-c3126ccae0c2.png) | ![临时任务](./界面截图/ae797f84-fdd5-4444-b371-4026bdbc7033.png) |

| 日常任务 · 发布看板 |
|---|
| ![日常任务](./界面截图/d1cef7bc-7044-44e2-9c8a-30006c37e474.png) |

---

## 功能特点

### 任务体系（三大类型）

| 类型 | 说明 |
|---|---|
| **日常任务** | 按天运行，支持草稿 → 生效中 → 已结束全流程，含次日补录、豁免、飞书定时通知 |
| **临时任务** | 三种模式：触达式（按账号归并）、主播式（仅触达主播身份）、管理式（按组织协同完成） |
| **协同任务（流转模式）** | 类审批流，A 完成后流转至 B，按顺序逐步推进直至结束 |

### 组织管理
- 支持多层级组织树：总部 → 基地 → 团队 → 大厅
- 可视化组织树编辑，支持批量操作与组织编码自动生成
- 各层级独立绑定飞书企业配置（`appId / appSecret`）

### 主播账号管理
- 主播注册审核流程
- 账号档案维护与多平台信息记录
- 多组织归属管理，支持跨组织视角

### 多角色权限体系
- 支持角色：`DEV_ADMIN` / `HQ_ADMIN` / `BASE_ADMIN` / `TEAM_ADMIN` / `HALL_MANAGER` / `ANCHOR`
- 同账号可持有多个身份，前端支持身份一键切换
- 基于 `scopePath` 的细粒度管理范围控制

### 飞书深度集成
- 飞书工作台免登（PC 客户端无感登录）
- Web OAuth 授权登录
- 飞书催办消息推送（日常/临时任务未完成提醒）
- 飞书账号绑定与解绑管理

---

## 技术栈

| 端 | 技术 |
|---|---|
| **前端** | React 18、TypeScript、Vite、Zustand、TailwindCSS、Recharts、PWA |
| **后端** | Node.js、Express、TypeScript、Prisma 5、MySQL、Redis、JWT、Zod |
| **三方集成** | 飞书开放平台（OAuth + JSSDK + 消息通知） |
| **基础设施** | Nginx、FRP 内网穿透 |

---

## 项目结构

```
Pendingweb/
├── frontend/          # React 前端（PC 管理端）
├── todo-h5/           # H5 移动端（主播我的待办）
├── backend/           # Express 后端 API
├── deploy/            # 部署配置示例
├── doce/              # 项目文档
├── LICENSE            # MIT 开源协议
└── OPEN_SOURCE_DECLARATION.md  # 开源声明
```

---

## 快速开始

### 环境要求

- Node.js >= 18
- MySQL >= 8.0
- Redis（可选）

### 安装依赖

```bash
npm install
```

### 配置环境变量

```bash
cp backend/.env.example backend/.env
# 编辑 .env 填写数据库连接信息、JWT 密钥等
```

### 启动开发环境

```bash
# Windows
start-dev.bat

# 或手动启动
npm run dev
```

---

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源，使用时请保留原作者署名。

详见 [开源声明](./OPEN_SOURCE_DECLARATION.md)。

---

## 作者

**yipeng1874-coder**

- GitHub：[@yipeng1874-coder](https://github.com/yipeng1874-coder)
- 仓库：[https://github.com/yipeng1874-coder/Pendingweb](https://github.com/yipeng1874-coder/Pendingweb)
