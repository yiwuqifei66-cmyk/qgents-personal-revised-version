# GitHub App：安装、改仓库、卸载与数据同步

日期：2026-08-14  
范围：Qgents 前端 GitHub 集成页与 GitHub 官网的职责划分。  
本文只说明产品流程与联调约定，不替代接口文档。

## 1. 先分清三件事

个人账号已经装过 App，**不等于**整个团队不能再装，也 **不等于** 顶部按钮该改成「调整仓库」。

| 用户想做的 | 该去哪 | 谁给链接 |
| --- | --- | --- |
| 个人已装过，再给 **组织**（或另一个 GitHub 账号）装一份 | GitHub `/apps/qgents/installations/new` | 后端 `POST .../installations` 返回的 `installationUrl` |
| 同一份安装上，**改仓库数量/范围** | GitHub **Configure**（已有安装的配置页） | 后端应提供 configure URL，或前端用 `providerInstallationId` 拼配置页 |
| **断开本团队连接**（GitHub 上 App 仍装着） | Qgents 调 `DELETE`（只删本地关联） | 见第 3 节 |
| **从 GitHub 卸掉** 这一份安装 | GitHub 配置页底部 Uninstall | 见第 4、5 节 |

顶部「安装 GitHub App」应继续只负责第一行。不要因为「已经装过」就把这个按钮改成「调整仓库」，否则组织安装入口会消失。

GitHub 对「同一账号重复走 `/installations/new`」会提示 `GitHub App has already been installed`。那是 GitHub 官网页面，不是前端画出来的 Install 按钮。

## 2. 建议的卡片操作

每张「已安装的 GitHub App」卡片三个动作分开：

1. **查看仓库**：进入 Qgents 自己的授权仓库页。
2. **断开 GitHub 连接**：调本系统 `DELETE`，只解除本团队 ↔ Installation 本地关联，**不会**在 GitHub 卸载 App。
3. **在 GitHub 卸载 Qgents App**：打开该 installation 的 Configure 页，用户在 GitHub 上真正卸载。

顶部「安装 GitHub App」只负责：再装到组织 / 另一个 GitHub 账号。

## 3. 在 Qgents 上断开连接（不是卸载 App）

```http
DELETE /teams/{teamId}/integrations/github/installations/{installationId}
Idempotency-Key: <unique-key>
```

这是 **本地断开**：只删本团队与 Installation 的关联。后端 **不得** 调用 GitHub Uninstall API。GitHub 上 App 仍装着，其他团队之后可以装到同一份 Installation X。

约定成功为 `204`，**响应体里没有新的安装列表或仓库列表**。项目仓库仍绑定时返回 `409 GITHUB_INSTALLATION_IN_USE`，前端 toast「请先解绑相关项目仓库」。

列表要更新，必须：

1. 用户点卡片「断开 GitHub 连接」。
2. 前端调用 `githubApi.deleteInstallation`。
3. 成功后 `invalidateQueries`：安装列表 + 团队授权仓库列表。
4. 页面重新 `GET`，卡片和仓库才会变。

从 GitHub 完整卸载 **没有** Qgents API，不要复用这个 DELETE。

## 4. 在 GitHub 上卸载，Qgents 如何同步

两条路，不能指望一个按钮覆盖两种入口。

| 用户在哪操作 | 怎样同步到另一边 |
| --- | --- |
| **Qgents 点断开连接** | 后端只删本地关联；GitHub 上 App 仍在。前端 invalidate 后 GET |
| **GitHub 网页卸载** | GitHub 发 webhook（如 `installation.deleted`）给后端改库（`DELETED` + 仓库 `REVOKED`）。没有 webhook 时列表不会自己变。补救：`POST .../installations/{id}/sync`，后端向 GitHub 核对，发现没了再删或标成 `DELETED` |

公网前端/回调域名 502 时，webhook 经常送不到，所以会出现：GitHub 已卸，Qgents 刷新后仍显示「已启用 + N 个仓库」。这通常是 **后端库仍有记录**，不是 TanStack Query 没清缓存。验证方法：看 Network 里 `GET .../installations` 是否仍返回该条。

## 5. 用户如何到达 GitHub 上「有卸载按钮」的页面

**不要**再点顶部「安装 GitHub App」。那条链路是：

`POST .../installations` → `installationUrl` 一般为  
`https://github.com/apps/qgents/installations/new?state=...`

这是 **新装 / 换账号**。已在该个人账号装过时，GitHub 会提示 already installed，**没有**卸载按钮。

卸载在 **已安装应用的配置页（Configure）**：

- 个人账号：`https://github.com/settings/installations/{providerInstallationId}`
- 组织：`https://github.com/organizations/{org}/settings/installations/{providerInstallationId}`

用户自己找：GitHub → Settings → Applications → Installed GitHub Apps → qgents → **Configure**。页面下方 Danger zone 才有 **Uninstall**。

卡片上的「在 GitHub 卸载 Qgents App」用列表项里的 `providerInstallationId` 拼配置页（GitHub 数字 ID，仅用于跳转/展示，不写入绑定 body）。

## 6. 「添加 / 调整授权仓库」会进入什么页

进入的是上一节的 **Configure**，不是 `/installations/new`。

该页通常包含：

- 上方：All repositories / Only select repositories，Save（改仓库范围）
- 下方：Uninstall（卸载整个 App）

因此：**调仓库的 GitHub 页面上，同时也有卸载按钮。** 用户若在那里卸载，Qgents 仍要靠 webhook 或用户点「同步」才会更新安装列表和仓库列表。

## 7. 前端相关代码位置（对照用）

| 能力 | 位置 |
| --- | --- |
| 生成新安装跳转并 `location.assign` | `src/hooks/useGithubInstall.ts` |
| `installed=1` 时 invalidate 列表 | `src/pages/GitHubIntegration/GitHubIntegrationPage.tsx` |
| `listInstallations` / `deleteInstallation` / `syncInstallation` | `src/api/github.ts` |
| 仓库页手动同步后 invalidate | `src/pages/GitHubIntegration/GithubInstallationReposPage.tsx` |

`providerInstallationId` 仅展示或跳转 GitHub 配置页；绑定、删除、同步路径一律用本地 UUID `id`。
