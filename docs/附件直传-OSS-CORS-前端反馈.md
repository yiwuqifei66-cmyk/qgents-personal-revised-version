# 附件直传 OSS 跨域失败：前端反馈与后端待办

> 反馈对象：后台组 / 运维
> 依据：`Qgents 接口文档v1.9.4.md` §18（附件直传与下载接口）
> 前端现状：`src/api/attachment.ts` 已实现「创建凭证 → PUT 直传 OSS → confirm → 发消息」链路
> 目的：确认 OSS 桶 `qgents` 是否已配置 Web 端跨域（CORS）规则；若未配置，请实现。

---

## 一、问题现象

Web 端（浏览器，`http://localhost:5173`）上传图片/文件失败。控制台两条报错，指向**同一个 OSS 预签名地址**：

```
https://qgents.oss-cn-guangzhou.aliyuncs.com/projects/{projectId}/attachments/{attachmentId}?Expires=...&OSSAccessKeyId=...&Signature=...
```

1. **403 Forbidden** —— 浏览器对该地址发 `OPTIONS` 预检请求，OSS 返回 403。
2. **CORS 拦截** —— `OPTIONS` 响应缺 `Access-Control-Allow-Origin` 头，真正的 `PUT` 被浏览器拦截。

**关键佐证：移动端直传同一后端、同一 OSS 桶，可正常上传。** 移动端不走浏览器 CORS 机制，也不发 `OPTIONS` 预检，所以不触发此问题。

---

## 二、根因分析

- 前端对 OSS 跨域地址执行 `PUT`（`src/api/attachment.ts` 中 `fetch(uploadUrl, { method: 'PUT', body: file })`）。
- 按浏览器规范，跨域 `PUT` 必先发送 `OPTIONS` 预检请求。
- OSS 桶 `qgents` 未配置允许来自 Web 来源（`http://localhost:5173` 等）的跨域规则，因此预检被拒。

**结论：非前端代码问题、非签名问题。** 文档 §18.1 已注明 `"headers": {}`（预签名 PUT 不要求固定请求头），即后端签名未包含 Content-Type，前端 PUT 请求本身合法。

---

## 三、需后端 / 运维确认并实现

请在阿里云 OSS 控制台为桶 `qgents` 配置 CORS 规则（如已配置，请告知实际规则内容，以便前端核对）：

| 配置项 | 值 |
|---|---|
| 来源 Origin | `http://localhost:5173`、`http://127.0.0.1:5173`、线上 Web 域名（如 `https://qgents.dpdns.org`） |
| 允许 Methods | `PUT`、`GET`、`OPTIONS` |
| 允许 Headers | `Content-Type`（或 `*`） |
| 暴露 Headers | `ETag`（建议，便于前端做完整性校验） |

> 注：OSS 的 PUT 直传必须走跨域预检，因此 **Methods 中必须包含 `OPTIONS`**，否则即使 `PUT` 被允许，预检仍会失败。

---

## 四、联调验证方式

CORS 配置生效后，Web 端无需改代码即可验证：

1. 前端在需求群点击 📎 选择图片/文件。
2. 观察控制台 Network：
   - `OPTIONS https://qgents.oss-cn-guangzhou.aliyuncs.com/...` → 应返回 2xx 且带 `Access-Control-Allow-Origin`。
   - `PUT https://qgents.oss-cn-guangzhou.aliyuncs.com/...` → 应返回 200。
3. 随后 `POST /projects/{projectId}/attachments/{attachmentId}/confirm` → 返回 `{"status":"READY"}`。
4. 群内出现 FILE / IMAGE 消息即链路打通。

---

## 五、如暂时无法配置 OSS CORS 的备选

若 OSS CORS 短期无法配置，可评估以下替代（需后端配合，前端按新方案调整 `uploadAttachment`）：

- **后端代理上传**：前端把文件 `POST` 到后端接口，由后端转发至 OSS（前端不直传 OSS，规避浏览器跨域）。
- **后端在响应中直接给出已可用的直传地址 + 允许来源**：本质上仍需 OSS CORS，故不推荐作为替代。

请后端优先实现第三节的 OSS CORS 配置，此为直传链路的标准前提。
