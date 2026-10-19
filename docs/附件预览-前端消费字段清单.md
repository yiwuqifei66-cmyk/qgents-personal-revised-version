# 附件预览与多模态输入 —— 前端实际消费字段清单

> 用途：后端同学对照实现 `preview-url` / `preview` / 消息 content 回填时，前端实际读取了哪些字段。
> 版本：与《Qgents 增量接口契约：附件内联预览 + 多模态输入》(v0.1) 对齐。
> 前端文件：`src/api/attachment.ts`、`src/types/group.ts`、`src/components/chat/AttachmentPreviewModal.tsx`、`src/components/chat/ChatPanel.tsx`

---

## 1. `GET /api/v1/projects/{projectId}/attachments/{attachmentId}/preview-url`

前端通过 `attachmentApi.previewUrl(projectId, attachmentId)` 调用（`src/api/attachment.ts`），
**只消费响应 `data` 层以下字段**（字段名必须为 camelCase，与契约 §4.1 完全一致）：

| 字段 | 类型 | 必填 | 前端用途 |
|---|---|---|---|
| `attachmentId` | string(UUID) | 是 | 弹窗标题、缓存 key |
| `fileName` | string | 是 | 弹窗标题展示（`preview?.fileName ?? fileName ?? '附件预览'`） |
| `mediaType` | string \| null | 否 | 预留；前端主要用 `previewType` |
| `sizeBytes` | number \| null | 否 | 预留 |
| `previewable` | boolean | 是 | 决定是"内联预览"还是"仅下载"（`previewable` false → 显示下载按钮） |
| `previewType` | string | 是 | 取值 `IMAGE` / `PDF` / `TEXT` / `CODE` / `UNSUPPORTED`（§2.1）；前端按它分支渲染 |
| `previewUrl` | string | 是 | **相对路径**，带短期 token；前端拼 `window.location.origin` 后直接给 `<img>` / `<iframe>` / 新标签 |
| `downloadUrl` | string \| null | 否 | `previewable=false` 或预览失败时，前端用它做"下载"按钮 |
| `expiresAt` | string(ISO8601) | 是 | 前端提示"过期后关闭重开重新签发"，并做 5 分钟 Query 缓存 |

**前端渲染分支**（`AttachmentPreviewModal.tsx`）：

| previewType | previewUrl 存在 | 前端行为 |
|---|---|---|
| `IMAGE` | 是 | `<img>` 页内放大 |
| `PDF` | 是 | `<iframe>` 内联预览（后端需支持 Range） |
| `TEXT` / `CODE` | 是 | 追加 `?raw=1` 拉原文，`<pre>` 高亮展示 |
| 其他 / 无 previewUrl | — | 显示下载按钮（用 `downloadUrl`） |
| 接口报错 | — | 显示"预览信息加载失败 + 下载按钮" |

> ⚠️ **重要**：如果后端响应字段名不是 camelCase（例如 `preview_type` / `preview_url`），
> 前端 `preview` 对象读不到任何字段 → 所有附件都走"不支持预览"分支（用户反馈过的 bug 即由此引起）。
> 请严格按上表 camelCase 返回。

---

## 2. `GET /api/v1/projects/{projectId}/attachments/{attachmentId}/preview`

前端**不直接调这个接口**，而是把 `preview-url` 返回的 `previewUrl`（已带短期 token）直接交给浏览器：

- 图片：`<img src={previewUrl}>`（契约 §2.2 Query 通道，无需 Authorization 头）
- PDF：`<iframe src={previewUrl}>`
- 文本/代码：`fetch(previewUrl + '&raw=1')` 拉原文

**后端需要保证**：
1. `preview` 端点支持 **双通道鉴权**：`Authorization: Bearer` 头 **或** `?token=` 查询参数（二选一即可通过）—— 因为前端用的都是带 token 的 URL，走 Query 通道
2. `Content-Disposition: inline`（内联展示，不触发下载）
3. 支持 `Accept-Ranges: bytes`（PDF 分页）；Range 非法返回 416
4. `raw=1` 时 TEXT/CODE 返回 UTF-8 原文

---

## 3. 消息 content 字段（发送 + 回显）

### 3.1 发送请求 `POST /api/v1/projects/{projectId}/groups/{groupId}/messages`

前端发送 IMAGE/FILE 时，content 结构（`ChatPanel.handleUpload`，§6.2）：

```json
// type = IMAGE
{
  "type": "IMAGE",
  "content": {
    "url": "https://.../attachments/{attachmentId}/content",
    "attachmentId": "0196...uuid"
  },
  "clientMessageId": "cmsg_..."
}

// type = FILE
{
  "type": "FILE",
  "content": {
    "url": "https://.../attachments/{attachmentId}/content",
    "attachmentId": "0196...uuid",
    "name": "配置说明.md",
    "size": 2048,
    "mimeType": "text/markdown"
  },
  "clientMessageId": "cmsg_..."
}
```

| content 字段 | 前端发送值 | 说明 |
|---|---|---|
| `attachmentId` | 必填 | 上传确认后返回的 READY 附件 ID |
| `url` | 必填 | `attachmentApi.contentUrl()` 拼的鉴权代理地址 |
| `name` | FILE 发送 | 文件名 |
| `size` | FILE 发送 | 字节数（前端类型字段名是 `size`，不是 `sizeBytes`） |
| `mimeType` | FILE 发送 | MIME 类型（前端类型字段名是 `mimeType`，不是 `mediaType`） |

> ⚠️ 字段名注意：前端发送用 `size` + `mimeType`（既有 §18 约定）；契约示例写 `sizeBytes` + `mediaType`。
> 若后端严格要求 `sizeBytes`/`mediaType`，请告知，前端可改为同时兼容。

### 3.2 响应回显（§6.3 + §7 可选增强）

前端 `MessageResponse.content` 期望**原样回显**上述字段（含 `attachmentId`），
若后端启用 §7 增强回填，前端额外消费：

| 字段 | 类型 | 必填 | 前端用途 |
|---|---|---|---|
| `previewUrl` | string | 否(增强) | **有则零请求直接预览**（`openFile`/图片放大直接用，不再调 preview-url） |
| `previewable` | boolean | 否(增强) | 文件卡片显示"点击预览"提示 |
| `previewType` | string | 否(增强) | 文件卡片图标（PDF/代码/图片区分） |

前端类型定义（`src/types/group.ts`）：

```ts
ImageMessageContent { url; attachmentId; width?; height?; previewUrl?; previewable?; previewType? }
FileMessageContent  { url; attachmentId; name; size; mimeType; previewUrl?; previewable?; previewType? }
```

---

## 4. 错误码（前端已按此处理）

| 接口 | code | HTTP | 前端行为 |
|---|---|---|---|
| preview-url | `UNAUTHORIZED` | 401 | 显示"预览信息加载失败" |
| preview-url | `FORBIDDEN` | 403 | 显示"预览信息加载失败"（无权访问） |
| preview-url | `ATTACHMENT_NOT_FOUND` | 404 | 显示"预览信息加载失败" |
| preview-url | `ATTACHMENT_NOT_READY` | 409 | 显示"预览信息加载失败" |
| preview-url | `ATTACHMENT_DOWNLOAD_UNSUPPORTED` | 501 | 显示"预览信息加载失败"（downloadUrl 可能为 null） |
| preview | `UNAUTHORIZED` | 401 | 图片 `<img>` 加载失败（fallback 占位） |
| preview | `ATTACHMENT_RANGE_INVALID` | 416 | PDF iframe 分页失败 |

---

## 5. 一句话给后端

> 前端消费 `preview-url` 响应的 **`attachmentId / fileName / previewable / previewType / previewUrl / downloadUrl / expiresAt`**（camelCase），
> `previewType` 必须取 `IMAGE/PDF/TEXT/CODE/UNSUPPORTED`；`previewUrl` 返回**相对路径带短期 token**；
> `preview` 端点需支持 `?token=` 查询通道 + `Content-Disposition: inline` + Range。
> 消息 IMAGE/FILE content 需回显 `attachmentId`（§6.3）；§7 增强回填 `previewUrl/previewable/previewType` 则前端零请求预览。
