# CORS 跨域：前端反馈与后端待办

> 反馈对象：后台组 / 运维
> 依据：`README/联调部署指南.md`「后端同学」一节
> 前端现状：`.env` 直连后端 `http://47.113.224.195:32500/api/v1`（`VITE_USE_MOCK=false`）
> 目的：请后端配置 `CORS_ALLOWED_ORIGINS`，消除跨域预检拦截

---

## 一、现象

前端 `http://localhost:5173` 直连后端 `47.113.224.195:32500`，控制台持续出现 `blocked by CORS policy` 报错，被拦截的接口包括（均为带 `Authorization: Bearer` 头的请求）：

| 接口 | 现象 |
|---|---|
| `GET /me` | CORS 拦截 + `net::ERR_FAILED` |
| `GET /projects/{projectId}/events`（SSE） | CORS 拦截 + `net::ERR_FAILED` |
| `GET /projects/{projectId}/merge-requests?status=OPEN` | CORS 拦截 + `net::ERR_FAILED` |
| `POST /notifications/{id}/read` | CORS 拦截 + `net::ERR_FAILED` |
| `GET /projects/{projectId}/attachments/{attachmentId}/content` | CORS 拦截 + `net::ERR_FAILED` |

**关键特征**：不带 `Authorization` 头的请求（部分 GET）能正常返回 200，带 `Authorization` 头的请求全部被拦——因为带鉴权头的跨域请求会先触发 `OPTIONS` 预检，预检响应缺 `Access-Control-Allow-Origin` 头即被浏览器拒绝。

## 二、影响（功能"看似正常"，实际已静默降级）

由于前端对这些请求做了兜底（失败静默 / 渲染空数据 / 用缓存），页面不崩、不弹错，但以下能力已悄悄失效：

1. **实时推送失效**：`/events` SSE 连不上，新消息、任务状态、动态变化不再实时刷新，只能手动刷新页面。
2. **通知已读不同步**：`POST /notifications/{id}/read` 被拦，点过的通知红点不清零。
3. **MR 列表可能不全**：`merge-requests?status=OPEN` 被拦，相关面板显示空或旧数据。
4. **图片/附件可能加载失败**：`/attachments/{id}/content` 鉴权下载接口被拦。

## 三、后端需完成

### 1. 配置 `CORS_ALLOWED_ORIGINS` 环境变量

后端 `.env`（Spring `application.yaml` 自动读取）加/改：

```properties
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://qgents.dpdns.org
```

### 2. 确认 CORS 放行范围

| 配置项 | 需包含 |
|---|---|
| 允许的请求头 | `Authorization`、`Content-Type`（必需）；`Idempotency-Key`（写接口） |
| 允许的方法 | `GET`、`POST`、`PATCH`、`PUT`、`DELETE`、`OPTIONS`（`OPTIONS` 为预检必需） |

> 注意：若 `allowCredentials(true)`，`allowedHeaders("*")` / `allowedMethods("*")` 可能不生效，需显式列出上述值。

### 3. 改完后重启 Spring Boot

环境变量为启动时读取，**修改后必须重启后端**才生效。

## 四、验证方式

后端配置并重启后，前端刷新页面验证：

1. 控制台 `blocked by CORS policy` 报错全部消失。
2. `GET /projects/{id}/events`（SSE）能正常挂起（不再 `ERR_ABORTED` / `ERR_FAILED`）。
3. 通知点击后红点正常清零（`POST /notifications/{id}/read` 返回 2xx）。
4. 图片/附件能正常加载（`GET /attachments/{id}/content` 返回 2xx）。

---

## 附：本次排查已确认的前端侧结论（与 CORS 无关，供参考）

- SSE 的 401 死循环重连（token 过期后无限重连刷屏）已由前端修复：token 过期时自动用 refresh token 换新 token 再重连，refresh 也失效则停止重连。此问题与 CORS 独立。
- OSS 直传 403（`SignatureDoesNotMatch`）已由前端修复：PUT 请求 body 改为 `ArrayBuffer` 避免自动带 `Content-Type` 头。
