# Nginx 本机与公司电脑通用示例配置

本文档用于当前 `D:\Pendingweb` 项目在以下场景下部署：

- 本机先验证正式访问形态
- 后续迁移到公司电脑
- FRP 地址保持不变
- 仅磁盘路径可能从 `D:` 盘迁移到 `C:` 盘

目标覆盖：

- PC 前端静态站点
- H5 静态站点
- `/api` 代理到后端
- `/uploads` 静态访问
- gzip 压缩
- 静态资源缓存
- SPA 路由刷新不 404

---

## 1. 推荐部署目录

### 1.1 本机验证目录

可直接使用当前构建产物目录：

- PC：`D:/Pendingweb/frontend/dist`
- H5：`D:/Pendingweb/todo-h5/dist`
- 上传目录：`D:/Pendingweb/backend/uploads`
- 后端：`http://127.0.0.1:4000`

### 1.2 公司电脑正式目录建议

建议后续整理为：

- PC：`C:/deploy/pc-web`
- H5：`C:/deploy/h5-web`
- 上传目录：`C:/deploy/uploads`
- 后端：`http://127.0.0.1:4000`

说明：

- Nginx 配置主体基本不变
- 迁移时主要修改 `root` / `alias` 路径

---

## 2. 部署前准备

正式使用前请先构建：

### 2.1 构建 PC 前端

```bash
npm run build -w frontend
```

### 2.2 构建 H5

```bash
cd todo-h5
npm run build
```

### 2.3 启动后端

开发验证阶段可继续使用本地后端 `4000` 端口。

后续正式环境建议改成 build 后运行，并配合 pm2 常驻。

---

## 3. Nginx 示例配置

以下示例假设：

- PC 独立端口：`8088`（本机因端口冲突改为 8088，公司电脑无冲突可用 8080）
- H5 独立端口：`8081`
- API 路径：`/api/`
- 上传文件路径：`/uploads/`

```nginx
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    tcp_nopush      on;
    tcp_nodelay     on;
    keepalive_timeout  65;

    gzip on;
    gzip_comp_level 6;
    gzip_min_length 1k;
    gzip_vary on;
    gzip_proxied any;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/xml
        image/svg+xml;

    server {
        listen       80;
        server_name  localhost;

        # PC 前端
        root D:/Pendingweb/frontend/dist;
        index index.html;

        # HTML 不长缓存，确保拿到最新入口
        location = /index.html {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }

        # PWA Service Worker 不缓存
        location = /sw.js {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }

        # PWA Manifest 不缓存
        location = /manifest.webmanifest {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
        }

        # PC 静态资源长缓存（Vite 文件名自带 hash）
        location /assets/ {
            root D:/Pendingweb/frontend/dist;
            expires 30d;
            add_header Cache-Control "public, max-age=2592000, immutable";
            try_files $uri =404;
        }

        # PC 单页应用路由回退
        location / {
            try_files $uri $uri/ /index.html;
        }

        # H5 静态站点
        location /h5/assets/ {
            alias D:/Pendingweb/todo-h5/dist/assets/;
            expires 30d;
            add_header Cache-Control "public, max-age=2592000, immutable";
            try_files $uri =404;
        }

        location = /h5/index.html {
            alias D:/Pendingweb/todo-h5/dist/index.html;
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }

        location /h5/ {
            alias D:/Pendingweb/todo-h5/dist/;
            try_files $uri $uri/ /h5/index.html;
        }

        # 后端 API 代理
        location /api/ {
            proxy_pass http://127.0.0.1:4000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # 上传文件访问
        location /uploads/ {
            alias D:/Pendingweb/backend/uploads/;
            expires 7d;
            add_header Cache-Control "public, max-age=604800";
            try_files $uri =404;
        }
    }
}
```

---

## 4. 如果迁移到公司电脑，只改这几处

如果以后目录改成 `C:/deploy/...`，优先改以下路径：

### 4.1 PC 根目录

把：

- `root D:/Pendingweb/frontend/dist;`

改成：

- `root C:/deploy/pc-web;`

### 4.2 H5 目录

把：

- `alias D:/Pendingweb/todo-h5/dist/assets/;`
- `alias D:/Pendingweb/todo-h5/dist/index.html;`
- `alias D:/Pendingweb/todo-h5/dist/;`

改成：

- `alias C:/deploy/h5-web/assets/;`
- `alias C:/deploy/h5-web/index.html;`
- `alias C:/deploy/h5-web/;`

### 4.3 上传目录

把：

- `alias D:/Pendingweb/backend/uploads/;`

改成：

- `alias C:/deploy/uploads/;`

---

## 5. 更新项目时是否每次都改 Nginx

通常不用。

### 5.1 只更新前端/H5页面

操作：

1. 重新 build
2. 替换对应 `dist` 内容

通常不需要改 Nginx 配置。

### 5.2 只更新后端逻辑

操作：

1. 重启后端服务

通常不需要改 Nginx 配置。

### 5.3 只有这些情况才需要改 Nginx

- 访问路径变化
- PC/H5 部署目录变化
- API 路径变化
- 上传目录变化
- gzip/cache 策略变化

---

## 6. 更新 Nginx 配置后如何生效

如果只是改配置，不需要重装 Nginx。

通常执行：

```bash
nginx -s reload
```

如果是 Windows 下直接运行 nginx，可在 nginx 安装目录执行。

---

## 7. 为什么这个方案适合你们

你们当前场景：

- FRP 地址固定
- 只是部署路径可能变化
- 企业内使用
- 想先本机验证，再迁公司电脑

因此这份配置的优势是：

1. 本机就能直接验证正式访问模型
2. 后续迁移时只改磁盘路径
3. gzip 与缓存规则可直接复用
4. `/api` 和 `/uploads` 代理逻辑可直接复用

---

## 8. 后续建议

如果准备正式上线到公司电脑，建议继续补两项：

1. `pm2` 后端常驻运行配置
2. 公司电脑更新项目标准流程文档

这样就能形成一套完整的可维护部署方案。
