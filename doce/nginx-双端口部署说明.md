# Nginx 双端口部署说明

当前推荐采用 PC 与 H5 独立端口部署，避免子路径 `/h5/` 带来的路由、缓存与跳转干扰。

## 1. 推荐端口

- PC：`8088`（本机 8080 端口被其他 nginx 实例占用，已改为 8088；公司电脑如无冲突可用 8080）
- H5：`8081`
- 后端：`4000`

FRP 推荐映射：

- PC：`29266 -> 8088`
- H5：`29267 -> 8081`

---

## 2. 推荐访问地址

### 本机
- PC：`http://localhost:8088/`
- H5：`http://localhost:8081/`

### 外网 / FRP
- PC：`http://frp7.ccszxc.site:29266/`
- H5：`http://frp7.ccszxc.site:29267/`

---

## 3. 当前 H5 配置要求

H5 已切回独立根路径模式：

- `vite.config.ts` 不再使用 `base: "/h5/"`
- `BrowserRouter` 不再使用 `basename="/h5"`

因此 H5 应单独部署到根路径站点，不再挂 `/h5/` 子路径。

---

## 4. Nginx 示例配置

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
        listen       8088;
        server_name  localhost;

        root D:/Pendingweb/frontend/dist;
        index index.html;

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

        location /assets/ {
            root D:/Pendingweb/frontend/dist;
            expires 30d;
            add_header Cache-Control "public, max-age=2592000, immutable";
            try_files $uri =404;
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
            alias D:/Pendingweb/backend/uploads/;
            expires 7d;
            add_header Cache-Control "public, max-age=604800";
            try_files $uri =404;
        }
    }

    server {
        listen       8081;
        server_name  localhost;

        root D:/Pendingweb/todo-h5/dist;
        index index.html;

        location = /index.html {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }

        location /assets/ {
            root D:/Pendingweb/todo-h5/dist;
            expires 30d;
            add_header Cache-Control "public, max-age=2592000, immutable";
            try_files $uri =404;
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
            alias D:/Pendingweb/backend/uploads/;
            expires 7d;
            add_header Cache-Control "public, max-age=604800";
            try_files $uri =404;
        }
    }
}
```

---

## 5. 迁移到公司电脑时主要改哪里

如果以后迁移到 `C:/deploy/...`，主要改：

### PC
- `root D:/Pendingweb/frontend/dist;` -> `root C:/deploy/pc-web;`

### H5
- `root D:/Pendingweb/todo-h5/dist;` -> `root C:/deploy/h5-web;`

### 上传目录
- `alias D:/Pendingweb/backend/uploads/;` -> `alias C:/deploy/uploads/;`

---

## 6. 更新时一般是否要改 Nginx

通常不用。

### 前端 / H5 页面更新
- 重新 build
- 替换 `dist`

### 后端逻辑更新
- 重启后端

### 只有这些情况才需要 reload Nginx
- 端口变化
- 根目录变化
- `/api` 规则变化
- `/uploads` 规则变化
- gzip / cache 规则变化

---

## 7. 推荐结论

对于当前项目，双端口比子路径方案更稳：

1. PC 与 H5 路由互不干扰
2. 不需要额外处理 H5 basename/base
3. 浏览器历史和缓存更清晰
4. 更适合 FRP 长期固定端口映射

---

## 8. PWA 支持

PC 前端已接入 PWA（渐进式网页应用）。

### 配置内容

- `vite-plugin-pwa` 已集成，build 后自动生成：
  - `dist/sw.js`（Service Worker）
  - `dist/manifest.webmanifest`（应用清单）
  - `dist/icon-192.png` / `dist/icon-512.png`

- Nginx 已对 `sw.js` 和 `manifest.webmanifest` 单独配置不缓存。

### 安装方式

用 **Chrome 或 Edge** 访问 `http://localhost:8088`，地址栏右侧出现安装按钮，点击即可安装到桌面。

### 注意事项

- PWA 安装需要 **HTTPS** 或 **localhost**。
- 通过 FRP HTTP 地址访问时不支持 PWA 安装。
- 如后续接入 HTTPS，则外网地址也可安装。
