# H5 仪表台与飞书 PC/H5 一键登录生产部署开发文档

## 1. 文档目的

本文用于指导当前项目在生产环境部署 PC、H5 和后端服务，说明本次 H5 全局仪表台、飞书网页登录、飞书客户端免登、账号绑定和自动身份定位的实现方式。

适用目录：

- PC 前端：`frontend`
- 手机 H5：`todo-h5`
- 后端 API：`backend`
- 默认数据库：MySQL
- 可选缓存：Redis

本文重点覆盖飞书登录相关内容；通用 FRP、Nginx 和数据库备份细节仍可结合以下文档使用：

- `公司电脑+FRP部署文档.md`
- `nginx-双端口部署说明.md`
- `数据库自动备份开发者文档.md`

---

## 2. 推荐生产拓扑

```text
PC 浏览器 / 飞书 PC 工作台
  -> PC 正式域名或 FRP 入口
  -> Nginx PC 站点
  -> frontend/dist

手机浏览器 / 飞书移动端工作台
  -> H5 正式域名或 FRP 入口
  -> Nginx H5 站点
  -> todo-h5/dist

PC、H5 的 /api/*
  -> Nginx 反向代理
  -> 127.0.0.1:4000
  -> backend
  -> MySQL / Redis / uploads
```

当前双端口部署约定：

| 服务 | 开发端口 | Nginx 端口 | 示例外网入口 |
| --- | ---: | ---: | --- |
| 后端 API | 4000 | 不直接公开 | 由 PC/H5 的 `/api` 代理 |
| PC Vite | 5173 | 8088 | `http://frp7.ccszxc.site:29266/` |
| H5 Vite | 4173 | 8081 | `http://frp7.ccszxc.site:29267/` |

生产环境应优先使用固定域名和 HTTPS。飞书回调地址、工作台主页、H5 可信域名必须使用同一套正式入口，不能混用开发端口和生产端口。

---

## 3. 上线前必须确认

### 3.1 基础环境

- Node.js、npm 版本已固定并在部署机验证。
- MySQL 可连接，生产数据库账号不使用 root。
- Redis 如已启用，必须配置持久化和访问控制。
- Nginx、后端守护进程和 FRP 均设置为开机启动。
- 部署机时间、时区统一为 `Asia/Shanghai`，并启用系统时间同步。
- `backend/uploads` 使用持久化目录并纳入备份。
- 数据库已经执行上线前备份，并验证过恢复流程。

### 3.2 安全配置

- `JWT_SECRET` 必须使用生产随机密钥，禁止保留 `dev-secret`。
- `DEV_ADMIN_PASSWORD` 必须修改，禁止使用示例密码。
- `DATABASE_URL`、`REDIS_URL`、飞书 `appSecret` 不得提交到 Git。
- 飞书 `appSecret` 只能保存在后端数据库或后端环境中，不能进入 PC/H5 构建产物。
- 对外只开放 Nginx/FRP 入口，不直接暴露 4000、5173、4173。
- 建议对登录接口增加网关限流、异常登录告警和访问日志保留策略。

### 3.3 单实例限制

当前后端进程内置以下分钟级调度任务：

- 临时任务状态收口
- 日常任务通知
- 临时任务催办
- 厅管日常任务激活与记录生成

在没有增加分布式锁之前，PM2 必须使用单实例：

```bash
pm2 start dist/server.js --name anchor-todo-api --instances 1
```

禁止直接开启 PM2 cluster 多实例，否则可能重复生成记录或重复发送飞书通知。

---

## 4. 后端生产环境变量

参考 `backend/.env.example` 创建 `backend/.env`：

```dotenv
PORT=4000
JWT_SECRET=请替换为高强度随机字符串
JWT_EXPIRES_IN=8h
DEV_ADMIN_PHONE=请填写生产管理员手机号
DEV_ADMIN_PASSWORD=请填写生产管理员初始密码
DATABASE_URL="mysql://app_user:strong_password@127.0.0.1:3306/anchor_todo"
REDIS_URL="redis://127.0.0.1:6379"

# 兼容旧部署的统一回调兜底
FEISHU_REDIRECT_URI=https://pc.example.com/pc/auth/callback

# 推荐：PC、H5 分开配置
FEISHU_REDIRECT_URI_PC=https://pc.example.com/pc/auth/callback
FEISHU_REDIRECT_URI_H5=https://h5.example.com/auth/callback
```

读取优先级：

- PC：`FEISHU_REDIRECT_URI_PC` → `FEISHU_REDIRECT_URI`
- H5：`FEISHU_REDIRECT_URI_H5` → `FEISHU_REDIRECT_URI`

修改 `.env` 后必须重启后端。只重启 Nginx或重新构建前端不会使后端环境变量生效。

---

## 5. 飞书开放平台配置

每条系统飞书企业配置都包含：

- 飞书应用名称
- App ID
- App Secret
- 所属基地
- 所属团队
- 启用状态

### 5.1 OAuth 重定向白名单

飞书应用中至少登记：

```text
https://pc.example.com/pc/auth/callback
https://h5.example.com/auth/callback
```

必须逐字符一致，包括：

- `http` 或 `https`
- 域名
- 端口
- 路径
- 是否存在尾部斜杠

### 5.2 H5 可信域名

移动端免登依赖飞书 H5 JS-SDK，需要将 H5 正式域名加入飞书应用的 H5 可信域名。签名 URL 使用当前页面去掉 hash 后的完整 URL，因此代理层不得擅自改写域名、协议或端口。

### 5.3 工作台主页

PC 工作台主页示例：

```text
https://pc.example.com/feishu-entry?appId=cli_xxxxxxxxx
```

H5 工作台主页示例：

```text
https://h5.example.com/feishu-entry?appId=cli_xxxxxxxxx
```

`appId` 必须与系统“飞书企业配置”中保存的 App ID 完全一致。App ID 是公开应用标识，可以出现在 URL；App Secret 绝对不能出现在 URL。

若同一系统维护多个飞书应用，每个工作台入口必须携带各自的 App ID，系统会据此定位对应的基地、团队和飞书企业配置。

### 5.4 建议权限

免登只获取用户凭证时使用空权限列表；兼容接口可能使用基础用户只读权限。实际飞书应用权限以当前开放平台审核结果为准。新增权限后需要重新发布飞书应用版本。

---

## 6. 构建与发布

### 6.1 安装依赖

在项目根目录执行：

```bash
npm ci
```

生产部署应优先使用 `npm ci`，并保持 `package-lock.json` 与代码版本一致。

### 6.2 构建三个项目

```bash
cd backend
npm run build

cd ../frontend
npm run build

cd ../todo-h5
npm run build
```

重要：根目录当前的 `npm run build` 只构建后端和 PC，不包含 H5。发布时必须单独执行 `todo-h5` 的构建命令。

预期产物：

- 后端：`backend/dist`
- PC：`frontend/dist`
- H5：`todo-h5/dist`

### 6.3 发布顺序

推荐顺序：

1. 备份数据库、`.env`、Nginx 配置和当前静态产物。
2. 安装依赖并完成三端类型检查。
3. 构建后端、PC、H5。
4. 发布 PC/H5 静态文件。
5. 重启后端单实例进程。
6. 检查后端启动日志。
7. 重载 Nginx。
8. 执行 PC、H5 和飞书真机验收。

静态文件建议使用版本目录加原子切换，避免复制过程中用户读取到新旧文件混合版本。

---

## 7. Nginx 必要规则

PC 与 H5 都是 SPA，必须配置路由回退；否则直接刷新 `/auth/callback`、`/feishu-entry`、`/dashboard` 会返回 404。

H5 站点核心示例：

```nginx
server {
    listen 8081;
    server_name h5.example.com;
    root C:/deploy/h5-web;
    index index.html;

    location /assets/ {
        try_files $uri =404;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
    }
}
```

PC 站点同样需要：

- `try_files $uri $uri/ /index.html`
- `/api/` 代理到 4000
- `/uploads/` 代理到 4000

`index.html` 不应设置长期强缓存；带 hash 的 `/assets/*` 可以长期缓存。

---

## 8. 登录链路说明

### 8.1 普通浏览器 OAuth

```text
登录页选择基地、团队、飞书企业
  -> GET /api/auth/feishu/login?action=login&client=pc|h5&configId=...
  -> 后端生成包含 action、client、configId、nonce 的 state
  -> 跳转飞书授权页
  -> 飞书回调 PC 或 H5 地址并携带 code、state
  -> POST /api/auth/feishu/complete-login
  -> 后端用 code 换取 open_id、union_id
  -> 根据 feishuConfigId + open_id/union_id 定位系统用户
  -> 返回 JWT、用户、有效身份和 recommendedIdentityId
  -> 前端写入登录态和当前身份
```

普通手机浏览器没有飞书客户端注入的 JS-SDK 能力，因此不能保证静默免登，应继续使用 OAuth 跳转。

### 8.2 飞书 PC/移动端工作台免登

```text
/feishu-entry?appId=...
  -> GET /api/auth/feishu/app-ids
  -> appId 映射 configId
  -> 飞书客户端 tt.requestAccess 获取临时 code
  -> 移动端先调用 /api/auth/feishu/jssdk-config 完成 H5 SDK 签名
  -> POST /api/auth/feishu/app-login
  -> 返回 JWT、身份列表和推荐身份
  -> 自动进入仪表台或我的待办
```

H5 成功免登后会在浏览器本地保存最近使用的 App ID，用于再次显示“飞书一键登录”。服务端仍会重新校验 App ID、配置状态、用户绑定状态和账号状态，本地值不参与鉴权。

### 8.3 账号绑定规则

系统用户必须事先绑定飞书账号。后端使用以下组合定位用户：

- `feishuConfigId`
- `feishuUnionId`，存在时优先参与匹配
- `feishuOpenId`

未绑定时返回 `FEISHU_UNBOUND`，不能自动创建生产账号。这样可以保留现有账号审批、角色授权和组织权限逻辑。

---

## 9. 自动身份定位规则

后端只返回状态有效、所属组织未暂停的身份；`DEV_ADMIN` 不受组织暂停过滤影响。

飞书登录存在组织上下文时，推荐顺序为：

1. 身份组织与飞书配置团队完全一致。
2. 身份位于该团队下级范围，例如厅管或主播身份。
3. 身份组织与飞书配置基地完全一致。
4. 身份位于该基地其他有效范围。
5. 不匹配组织上下文的其他身份。

同一层级内继续按照以下规则排序：

1. 角色级别：`DEV_ADMIN → HQ_ADMIN → BASE_ADMIN → TEAM_ADMIN → HALL_MANAGER → ANCHOR`
2. 最近切换时间较新的优先。
3. 最早授权的身份优先。
4. 身份 ID 作为稳定兜底排序。

账号密码登录没有飞书组织上下文，因此从角色级别开始排序。

H5 登录成功时会同时写入：

- token
- user
- identities
- currentIdentity

这可以避免只有一个身份时仍被送回身份选择页，也避免切换账号后沿用旧账号身份。

用户手动切换身份时调用：

```http
POST /api/identities/switch
Authorization: Bearer <token>
Content-Type: application/json

{"identityId":"..."}
```

后端会再次验证身份归属、状态和组织状态，并更新 `lastSwitchedAt`。

---

## 10. H5 全局仪表台开发说明

### 10.1 功能定位

H5 仪表台是 PC 驾驶舱在手机端的专用展示界面，不是把 PC 页面按比例缩小。它复用 PC 后端的数据、权限和统计口径，但使用适合手机的卡片、点击展开和横向滚动方案。

当前 H5 仪表台定位为查看与下钻，不提供主播数据上传、直播间编辑、留存上传或过程指标配置。上述录入与配置仍在 PC 完成，H5 读取同一后端的最新结果。后续若增加手机端写入功能，必须单独复用 PC 的写权限校验、审计和数据校验，不能直接把 PC 上传按钮移植到 H5。

H5 路由：

```text
/dashboard
```

核心页面：

```text
todo-h5/src/pages/DashboardPage.tsx
```

底部导航根据当前身份决定是否显示“仪表台”入口：

```text
todo-h5/src/components/MobileBottomNav.tsx
```

### 10.2 访问权限

访问 H5 仪表台必须同时满足角色和权限两个条件。

允许角色：

- `DEV_ADMIN`
- `HQ_ADMIN`
- `BASE_ADMIN`
- `TEAM_ADMIN`

所需权限：

```text
task:report:view
```

`*` 权限同样允许访问。

权限判断分为三层：

1. `/dashboard` 由 `IdentityRequiredRoute` 检查 token 和当前身份。
2. `canOpenDashboard` 检查当前角色是否属于管理角色。
3. 页面请求 `/me/permissions`，确认存在 `task:report:view` 或 `*`。

没有权限时不能只隐藏底部入口，页面和后端接口仍必须独立校验。

### 10.3 基地与数据范围

| 身份 | 基地选择 | 数据范围 |
| --- | --- | --- |
| `DEV_ADMIN` | 页面顶部选择基地 | 可见权限范围内的基地 |
| `HQ_ADMIN` | 页面顶部选择基地 | 可见权限范围内的基地 |
| `BASE_ADMIN` | 不显示选择器 | 自动使用当前身份组织 |
| `TEAM_ADMIN` | 不显示选择器 | 自动使用当前团队身份范围 |

`DEV_ADMIN` 和 `HQ_ADMIN` 会读取 `/orgs/tree`，过滤状态为 active、类型为 BASE 且位于 `identity.scopePath` 范围内的组织。

页面传递的 `scopeOrgId` 只是查询条件，最终数据范围必须由后端根据 `X-Identity-Id` 再次限制，禁止将前端选择器当成权限边界。

对于直播间分配明细，`TEAM_ADMIN` 在 H5 中只展示当前团队的 allocation，避免看到其他团队分配细节。

### 10.4 当前模块清单

#### 10.4.1 日常任务完成率

包含两个页签：

- 主播日常
- 厅管日常

固定统计区间：

- 昨天
- 近 3 天
- 近 7 天
- 本月

统计截止日期统一为昨天，不把当天尚未结束的任务混入历史完成率。

手机端采用一行两列摘要卡。点击某个区间后，在卡片组下方展开团队完成明细；同一时间只展开一个区间，再次点击收起。

接口：

```text
GET /tasks/report/daily-range-stats
GET /tasks/report/hall-daily-range-stats
```

#### 10.4.2 基地直播间空余

按场地展示：

- 房间类型
- 已使用数 / 总数
- 总数
- 已分配
- 已使用
- 空余

场地卡片采用一行两列横向滚动，避免纵向留白过多。点击有分配数据的房间类型后，在模块下方展开团队使用明细，而不是使用悬浮层，避免移动端遮挡和越界。

接口：

```text
GET /live-room-capacity/latest?scopeOrgId=...
```

#### 10.4.3 主播数量统计

展示三个核心指标：

- 主播总数，并显示线上/线下人数
- 7 天内新增及占比
- 20 天内新增及占比

支持无试用期以及指定试用期天数。点击统计卡后，在下方展开运营维度明细；再次点击收起。

接口：

```text
GET /anchor-summary/trend?days=7&scopeOrgId=...&probationDays=...
```

#### 10.4.4 在职/离职人数音浪趋势

支持四种指标切换：

- 在职人数
- 在职音浪
- 离职人数
- 离职音浪

每个指标都区分线上和线下。页面默认展示基地汇总，也可以选择具体团队。点击日期后展开该日期的团队明细。

接口：

```text
GET /staff-turnover/by-date?days=6&scopeOrgId=...
```

H5 必须始终同时展示线上、线下图例，不能只显示总人数或总音浪。

#### 10.4.5 留存率看板

按月份展示：

- 3 天流失
- 15 天流失
- 30 天流失
- 在职人数
- 留存率

计算口径：

```text
留存率 = 在职人数 /（3天流失 + 15天流失 + 30天流失 + 在职人数）
```

月份卡片采用横向滚动。选择“全部团队”时，点击月份可在下方展开团队明细；选择具体团队后只展示该团队数据，不再重复展开明细。

接口：

```text
GET /retention/by-month?months=6&scopeOrgId=...
```

#### 10.4.6 过程指标

采用横向滚动矩阵展示，行是团队，列包括：

- 最近 7 个日期
- 本周综合
- 上周综合
- 上月综合

首列团队名保持吸附，数据单元格直接展示百分比，不使用进度条和多余边框，以压缩手机端列宽。

点击团队与日期/综合周期交叉单元格后，在表格下方展开该团队的厅完成率明细。

接口：

```text
GET /process-metric/by-date?days=60&scopeOrgId=...
GET /process-metric/config?scopeOrgId=...
```

过程指标只展示配置中参与统计的团队；配置缺失时使用接口返回的可用团队作为兼容展示。

### 10.5 H5 仪表台接口映射

| 模块 | H5 服务方法 | 后端接口 |
| --- | --- | --- |
| 权限 | `getPermissions` | `/me/permissions` |
| 基地列表 | `getOrgTree` | `/orgs/tree` |
| 主播日常完成率 | `getDailyRangeStats` | `/tasks/report/daily-range-stats` |
| 厅管日常完成率 | `getHallDailyRangeStats` | `/tasks/report/hall-daily-range-stats` |
| 直播间空余 | `getLiveRoomCapacity` | `/live-room-capacity/latest` |
| 主播数量 | `getAnchorTrend` | `/anchor-summary/trend` |
| 在职/离职趋势 | `getStaffTurnoverByDate` | `/staff-turnover/by-date` |
| 留存率 | `getRetentionByMonth` | `/retention/by-month` |
| 过程指标 | `getProcessMetrics` | `/process-metric/by-date` |
| 过程指标团队配置 | `getProcessMetricConfig` | `/process-metric/config` |

请求统一通过 `todo-h5/src/services/http.ts` 发送，并自动附加：

```http
Authorization: Bearer <jwt>
X-Identity-Id: <currentIdentityId>
```

### 10.6 移动端交互规范

后续扩展仪表台时遵守以下规则：

1. 不照搬 PC 固定宽度布局，不通过整体缩放适配手机。
2. 高频摘要优先一屏展示，详细数据采用点击展开。
3. 展开详情放在所属模块内部，避免绝对定位浮层遮挡相邻模块。
4. 同类详情默认只展开一项，减少页面高度突然增长。
5. 两个以上同类卡片可使用横向滚动，并保留明确的滚动线索。
6. 宽表格使用横向滚动和首列吸附，优先压缩列宽，不使用无信息价值的进度条。
7. 卡片高度由内容决定，不使用固定大高度制造空白。
8. 点击区域不小于可触控尺寸，并提供 active 状态和展开箭头。
9. 所有模块必须具备加载、空数据、错误三种状态。
10. 页面刷新按钮应同时刷新全部模块，并在任一模块加载时显示忙碌状态。

关键样式集中在：

```text
todo-h5/src/styles.css
```

与仪表台有关的类名前缀主要包括：

- `simple-*`
- `history-*`
- `room-*`
- `anchor-*`
- `turnover-*`
- `retention-*`
- `process-*`

### 10.7 数据加载与错误隔离

日常完成率和直播间数据使用同一批并行请求；主播数量、人员趋势、留存率、过程指标分别维护独立的 loading 和 error 状态。

这样某一个统计模块接口失败时，其他模块仍能正常展示。新增模块不得把所有请求合并成一个“任一失败则整页失败”的串行流程。

切换身份、基地、试用期或团队时，需要同时清理已经展开的旧详情，避免新范围继续显示旧范围的明细。

日期口径使用北京时间生成。修改日期逻辑时不能直接依赖浏览器本地时区，否则异地设备可能出现日期偏移。

### 10.8 仪表台生产部署注意事项

- H5 必须部署到站点根路径，当前不使用 `/h5/` basename。
- Nginx 必须支持 `/dashboard` 的 SPA 回退。
- `/api` 必须与 H5 保持同源代理，否则需要额外处理 CORS 和飞书可信域名。
- 仪表台接口较多，Nginx 和网关超时不能设置过短。
- 不建议缓存带身份的数据接口；静态 assets 可以长期缓存。
- 后端上传类数据更新后，H5 点击刷新应能获得最新数据。
- 发布新 H5 后应验证旧 localStorage 登录态升级不会残留错误身份。
- 数据为空时展示空状态，不得使用演示数据填充生产页面。

### 10.9 仪表台专项验收

- 管理角色登录后自动进入 `/dashboard`。
- 非管理角色登录后进入 `/todos`，底部不显示仪表台入口。
- 缺少 `task:report:view` 时无法查看仪表台。
- `DEV_ADMIN`、`HQ_ADMIN` 可以切换有效基地。
- `BASE_ADMIN`、`TEAM_ADMIN` 不显示多余基地选择器。
- 主播/厅管日常可以切换，四个历史区间统计正确。
- 完成率详情点击展开、再次点击收起且不会留下空白占位。
- 直播间场地一行两列并可左右滑动。
- 直播间团队分配明细点击展开，不出现浮层遮挡。
- 主播总数、7 天新增、20 天新增都能展开运营明细。
- 在职/离职人数与音浪均区分线上、线下。
- 留存月份可以横向滚动并展开团队明细。
- 过程指标可横向滚动，团队列吸附，数值列宽紧凑。
- 过程指标点击数值能展开厅完成率明细。
- 任一模块无数据或失败时，其他模块仍可使用。
- 切换基地和身份后不显示上一范围的展开详情。

---

## 11. 关键接口

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/auth/login` | POST | 手机号密码登录 |
| `/auth/feishu/base-options` | GET | 飞书登录基地选项 |
| `/auth/feishu/team-options` | GET | 飞书登录团队选项 |
| `/auth/feishu/configs` | GET | 飞书企业配置选项 |
| `/auth/feishu/login` | GET | 发起 PC/H5 OAuth |
| `/auth/feishu/complete-login` | POST | 完成 OAuth 登录 |
| `/auth/feishu/app-ids` | GET | App ID 与配置 ID 映射 |
| `/auth/feishu/jssdk-config` | GET | 获取移动端 H5 SDK 签名 |
| `/auth/feishu/app-login` | POST | 飞书客户端免登 |
| `/auth/feishu/bind` | POST | OAuth 绑定飞书账号 |
| `/auth/feishu/app-bind` | POST | 飞书客户端内绑定账号 |
| `/identities/switch` | POST | 校验并切换当前身份 |

所有业务请求继续使用原有鉴权头：

```http
Authorization: Bearer <jwt>
X-Identity-Id: <currentIdentityId>
```

新增页面或接口不得仅相信前端保存的身份，后端必须继续使用 `authRequired` 和 `identityRequired` 校验。

---

## 12. 开发目录与职责

### 12.1 后端

- `backend/src/modules/auth/routes.ts`
  - 飞书 OAuth
  - 飞书客户端免登
  - JS-SDK 签名
  - 推荐身份计算
- `backend/src/modules/identity/routes.ts`
  - 身份列表
  - 身份切换与状态校验
- `backend/src/middleware/authRequired.ts`
  - JWT 校验
- `backend/src/middleware/identityRequired.ts`
  - 当前身份及权限上下文校验

### 12.2 PC

- `frontend/src/pages/login/LoginPage.tsx`
- `frontend/src/pages/auth/FeishuCallbackPage.tsx`
- `frontend/src/pages/feishu-entry/FeishuEntryPage.tsx`
- `frontend/src/shared/utils/feishu.ts`
- `frontend/src/shared/utils/identity.ts`

### 12.3 H5

- `todo-h5/src/pages/LoginPage.tsx`
- `todo-h5/src/pages/FeishuCallbackPage.tsx`
- `todo-h5/src/pages/FeishuEntryPage.tsx`
- `todo-h5/src/pages/IdentityPage.tsx`
- `todo-h5/src/pages/DashboardPage.tsx`
- `todo-h5/src/components/MobileBottomNav.tsx`
- `todo-h5/src/services/task.ts`
- `todo-h5/src/utils/feishu.ts`
- `todo-h5/src/utils/identity.ts`
- `todo-h5/src/stores/auth.ts`
- `todo-h5/src/services/auth.ts`

---

## 13. 开发约束

1. PC、H5 的 OAuth 必须显式传递 `client=pc` 或 `client=h5`。
2. 回调必须使用后端生成的 state 中的 `configId`，不能由前端在回调后重新猜测企业。
3. 飞书授权 code 只能使用一次；React 开发环境可能重复执行 effect，新增回调逻辑时必须避免重复提交。
4. 移动端 JS-SDK 签名请求必须携带 `configId`，否则无法选择正确 App Secret。
5. JS-SDK 签名 URL 必须使用当前页面去掉 hash 的完整地址。
6. 不能只根据 User-Agent 判定登录成功；User-Agent 只用于选择客户端能力，最终身份由后端校验。
7. 自动身份推荐应由后端给出 `recommendedIdentityId`，PC/H5 只做兼容性兜底。
8. 新增角色时必须同步角色排序、入口页面和权限矩阵。
9. 手动身份切换必须调用 `/identities/switch`，不能只修改本地状态。
10. 登出或新账号登录必须清除旧 `currentIdentity`。
11. 任何错误日志都不得打印 App Secret、JWT、完整数据库连接串。

---

## 14. 验收清单

### 14.1 构建检查

```bash
cd backend && npm run typecheck && npm run build
cd ../frontend && npm run typecheck && npm run build
cd ../todo-h5 && npm run typecheck && npm run build
```

### 14.2 浏览器验收

- PC 手机号密码登录正常。
- H5 手机号密码登录正常。
- PC 飞书 OAuth 回到 `/pc/auth/callback`。
- H5 飞书 OAuth 回到 `/auth/callback`。
- 单身份账号登录后直接进入正确页面。
- 多身份账号能自动定位推荐身份，并可手动切换。
- 管理身份进入 H5 `/dashboard`。
- 厅管、主播等身份进入 H5 `/todos`。
- 暂停组织身份无法切换。
- 退出后不能继续访问受保护页面。

### 14.3 飞书真机验收

- 飞书 PC 工作台进入后能够免登。
- 飞书移动端工作台进入后能够免登。
- 首次未绑定账号显示明确提示。
- App ID 错误时显示“未关联系统组织”。
- H5 可信域名错误时能够从 JS-SDK 错误定位原因。
- token 过期后重新进入工作台能够重新登录。
- 不同飞书企业应用会定位到对应基地、团队身份。

### 14.4 运维验收

- 后端只有一个生产实例。
- Nginx `/api` 和 `/uploads` 代理正常。
- SPA 页面直接刷新不返回 404。
- `index.html` 没有长期缓存。
- 数据库、上传文件、`.env` 已备份。
- 后端启动日志无数据库兼容、端口占用或通知调度错误。

---

## 15. 常见故障排查

### 15.1 `FEISHU_REDIRECT_NOT_CONFIGURED`

检查：

- `FEISHU_REDIRECT_URI_PC`
- `FEISHU_REDIRECT_URI_H5`
- 修改后是否重启后端

### 15.2 飞书提示重定向地址不合法

比较飞书开放平台白名单与后端环境变量，重点检查协议、端口、路径和尾部斜杠。

### 15.3 H5 显示飞书 SDK 未加载

检查：

- 是否从飞书客户端工作台打开
- H5 页面能否访问飞书 CDN
- `todo-h5/index.html` 是否加载 H5 JS-SDK
- 企业网络是否拦截飞书静态资源域名

### 15.4 H5 SDK 签名失败

检查：

- H5 域名是否加入可信域名
- `/auth/feishu/jssdk-config` 是否携带 `url` 和 `configId`
- Nginx/FRP 是否改变协议、Host 或端口
- 工作台 URL 与实际打开 URL 是否一致
- 服务器时间是否准确

### 15.5 `FEISHU_UNBOUND`

该飞书用户尚未绑定系统账号，或绑定在另一条飞书企业配置下。先使用手机号登录，再按现有绑定流程处理。

### 15.6 登录后身份不正确

依次检查：

1. 飞书工作台 URL 中的 App ID。
2. App ID 对应的系统飞书企业配置。
3. 配置中的基地、团队是否正确。
4. 用户有效身份的 `orgId`、`scopePath`。
5. 接口返回的 `recommendedIdentityId`。
6. `/identities/switch` 是否成功更新 `lastSwitchedAt`。

### 15.7 刷新回调页或业务页出现 404

Nginx 缺少 SPA 回退，确认存在：

```nginx
try_files $uri $uri/ /index.html;
```

### 15.8 H5 发布后仍看到旧页面

检查 Nginx 是否仍指向旧目录，并清理浏览器站点缓存。PC 启用了 PWA，更新 PC 时还需确认 Service Worker 已更新。

---

## 16. 回滚方案

出现生产故障时：

1. 停止继续发布。
2. 保留当前后端日志和 Nginx 访问日志。
3. 将 PC/H5 静态目录切回上一版本。
4. 将后端进程切回上一构建版本并重启单实例。
5. 若包含数据库变更，按照对应迁移文档执行兼容回滚；禁止直接覆盖生产数据库。
6. 分别验证手机号登录、PC 飞书登录、H5 飞书登录和身份切换。

飞书开放平台配置一般不应在代码回滚时立即删除。优先保留新旧回调白名单，确认旧版本恢复稳定后再清理废弃地址。

---

## 17. 本次功能验收基线

本次 PC/H5 飞书登录改造完成后的最低基线：

- 后端、PC、H5 类型检查通过。
- 后端、PC 生产构建通过。
- H5 生产构建通过。
- PC/H5 使用同一个后端账号绑定和身份权限来源。
- H5 支持普通 OAuth 与飞书工作台免登两种方式。
- H5 管理身份可进入全局仪表台并按身份范围读取数据。
- H5 仪表台包含完成率、直播间、主播数量、人员趋势、留存率和过程指标模块。
- 飞书登录能够根据应用对应组织推荐身份。
- H5 登录不会残留上一个账号的当前身份。
- 手动身份切换经过后端校验并记录最近使用时间。
