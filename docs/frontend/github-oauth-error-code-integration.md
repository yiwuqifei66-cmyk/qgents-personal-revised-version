# GitHub 个人 OAuth 错误码对接注意事项

## 适用范围

本说明对应后端个人 GitHub 仓库自动创建链路。团队 GitHub App Installation 与个人 GitHub OAuth 是两套独立授权，不能互相替代。

## 后端稳定错误码

| 错误码 | 含义 | Web/移动端处理 |
| --- | --- | --- |
| `GITHUB_OAUTH_REQUIRED` | 当前用户没有个人 GitHub OAuth 记录 | 提示“请先绑定个人 GitHub”，跳转个人 OAuth 绑定页；不要提示重新安装团队 GitHub App |
| `GITHUB_OAUTH_REVOKED` | 有授权记录，但状态不是 `ACTIVE` | 提示授权已失效，要求重新发起个人 OAuth；不要静默重试建仓 |
| `GITHUB_OAUTH_TOKEN_INVALID` | OAuth token 校验失败 | 提示重新绑定；如后端返回该码，按失效授权处理 |
| `GITHUB_OAUTH_SCOPE_INSUFFICIENT` | OAuth scope 不足，通常影响私有个人仓库 | 提示重新授权获取 `repo` scope，或改建公开仓库 |

客户端应优先读取 `error.code`，文案只作兜底；不要只根据 HTTP 状态码区分这几类错误。

## Web 端注意事项

- 创建项目/自动建仓失败时保持表单和弹窗打开，展示稳定错误码对应的可操作提示。
- 收到 OAuth 相关错误后刷新 `GET /me/integrations/github/oauth`，避免授权状态刚变化时继续使用旧缓存。
- 个人 Installation 仍需校验 OAuth 登录账号与 Installation 账号一致；组织 Installation 不要求个人 OAuth。
- `GITHUB_REPOSITORY_NOT_AUTHORIZED` 表示仓库可能已经在 GitHub 创建，但 GitHub App 看不到它，不能引导用户重复绑定 OAuth。
- 写请求继续复用同一个 `Idempotency-Key`，用户点击重试前不要自动发起多次建仓请求。

## 移动端注意事项

- Retrofit/网络层保留统一错误体中的 `error.code` 和 `error.message`，不要把 409 统一转换成普通网络错误。
- 建议在建仓错误映射中增加：
  - `GITHUB_OAUTH_REQUIRED`：跳转个人 GitHub OAuth 页面；
  - `GITHUB_OAUTH_REVOKED`、`GITHUB_OAUTH_TOKEN_INVALID`：跳转重新绑定页面；
  - `GITHUB_OAUTH_SCOPE_INSUFFICIENT`：提示重新授权或改用公开仓库。
- OAuth 回调返回后重新调用授权状态接口，不以本地回调参数直接判定已绑定成功。
- 用户取消授权、回调失败或网络超时时保留当前创建项目表单，允许重新发起授权，不要丢失用户输入。
- 团队 App 安装页面和个人 OAuth 页面保持分开；`GITHUB_OAUTH_REQUIRED` 不应跳转到团队 App 安装页。

## 联调检查清单

1. 未绑定个人 OAuth，创建个人仓库：返回 `GITHUB_OAUTH_REQUIRED`。
2. 撤销/失效个人 OAuth，创建个人仓库：返回 `GITHUB_OAUTH_REVOKED`。
3. 组织 Installation 创建仓库：不应因为没有个人 OAuth 被客户端拦截。
4. OAuth 账号与个人 Installation 账号不一致：客户端禁用该 Installation，并展示账号不一致提示。
5. 建仓失败后刷新授权状态，重试请求只发送一次并携带新的幂等键。
