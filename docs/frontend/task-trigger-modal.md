# TaskTriggerModal 接入说明

TaskTriggerModal 负责创建 Task，并复用项目仓库 Query 提供仓库选项。

创建请求使用 `POST /projects/{projectId}/tasks`，请求字段为：

- `requirementGroupId`
- `title`
- `requirement`
- `repositoryIds`
- `baseRef`

标题、需求说明和 baseRef 必填，至少选择一个仓库。没有可用仓库时显示空状态并禁止提交。

创建成功后使用服务端返回的 Task，刷新 Task 列表和详情缓存，并导航到任务中心的 `?taskId=...`。页面提示用户任务已提交至云端，可以安全离开页面。
