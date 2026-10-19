import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeleteGithubInstallation, useGithubInstallRedirect } from '@/hooks/useGithubInstall'
import {
  Typography,
  Card,
  Button,
  Tag,
  Space,
  Empty,
  Alert,
  App,
  theme,
  Row,
  Col,
  Spin,
} from 'antd'
import {
  PlusOutlined,
  ArrowLeftOutlined,
  GithubOutlined,
  EyeOutlined,
  DisconnectOutlined,
  ExportOutlined,
} from '@ant-design/icons'
import { githubApi } from '@/api/github'
import { queryKeys } from '@/query/queryKeys'
import { PATHS } from '@/routes/paths'
import { formatApiError } from '@/utils/formatApiError'
import { DarkPage } from '@/components/DarkPage'
import {
  countAuthorizedRepositories,
  formatGithubDateTime,
  githubInstallationConfigureUrl,
  type GithubInstallation,
} from '@/types/github'

/**
 * ============================================================================
 * GitHub 集成页 —— 接口文档 §6
 *
 * 入口：我的团队 → 我创建的团队 → 查看详情 →「github集成」
 * 路由：/app/integrations/github?teamId=xxx
 *
 * 【本页「安装Github App」按钮职责】
 * 1. 校验 teamId（来自 URL query）
 * 2. POST /teams/{teamId}/integrations/github/installations
 * 3. 只跳转 /apps/{slug}/installations/new（已装过也走 new，不进 Configure）
 *
 * 【回调说明】
 * GET /integrations/github/callback 由 GitHub 打到后端，前端不直接请求。
 * 后端处理完后 302 回本页：
 *   成功：?teamId=xxx&installed=1
 *   归属冲突：?teamId=xxx&installed=0&conflict=GITHUB_INSTALLATION_TEAM_CONFLICT&message=...
 * 本页 useEffect 分别提示成功 / 错误，并清理一次性 query 参数。
 *
 * 【页面结构】
 * - 上：已安装的 GitHub App（个人 User / 组织 Organization 卡片）
 * - 卡片「查看仓库」→ 跳转独立页 GithubInstallationReposPage
 * - 卡片「解除关联」→ DELETE .../installations/{id}，只解本地关联，不卸 GitHub App
 * - 卡片「在 GitHub 卸载 Qgents App」→ 打开 GitHub Configure，真正卸载走 GitHub
 * - 仓库页「绑定该仓库到项目」→ BindRepoToProjectPage（团队项目列表）
 *
 * 相关文件：
 * - API：src/api/github.ts
 * - 类型：src/types/github.ts
 * - Mock：src/mocks/handlers.ts
 * ============================================================================
 */

const { Title, Paragraph, Text } = Typography

// export interface GithubInstallation {
//   installationId: string
//   accountLogin: string
//   accountType: 'User' | 'Organization'
//   installedAt: string
//   status: 'ACTIVE' | 'EXPIRED'
//   /** 可选：后端若直接返回授权仓库数则可展示；没有则前端用 repositories 列表统计 */
//   authorizedRepoCount?: number
// }
// 已冻结见 docs：Installation 主键为 id；accountType = USER | ORGANIZATION；status 不含 EXPIRED。
function accountTypeLabel(type: GithubInstallation['accountType']): string {
  return type === 'ORGANIZATION' ? 'GitHub 组织' : 'GitHub 个人账号'
}

function statusTag(status: GithubInstallation['status']) {
  if (status === 'ACTIVE') return <Tag color="success">已启用</Tag>
  if (status === 'SUSPENDED') return <Tag color="warning">已暂停</Tag>//Webhook 同步时，GitHub 如果发了暂停事件，后端就会给 SUSPENDED
  return <Tag>已卸载</Tag>
}

// 给当前团队安装 GitHub App
export function GitHubIntegrationPage() {
  return (
    <DarkPage>
      <GitHubIntegrationPageInner />
    </DarkPage>
  )
}

export default GitHubIntegrationPage

function GitHubIntegrationPageInner() {
  const { token } = theme.useToken()
  const { message, modal } = App.useApp() //toast / 确认框
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // JS 代码里做页面跳转（编程式导航）
  // ReactRouter hook，用来读写 url 问号后面参数：
  const [searchParams, setSearchParams] = useSearchParams()
  // searchParams 是 useSearchParams() 返回的对象，代表当前 url 问号后的全部参数。

  /**
   * teamId 来源（优先级）：
   * 1. URL ?teamId=xxx（团队详情「github集成」按钮带入）
   * 2. 缺省 mock：team-xinghe（仅本地演示；联调后应强制要求 URL 带 teamId）
   *
   * TODO[后端联调] 若无 teamId，应提示用户从团队详情进入，而不是静默用默认值
   */
  const teamId = searchParams.get('teamId') || 'team-xinghe' //A是假值就返回B

  // 从 GitHub 卸/改仓库再切回本页时，重新拉安装和仓库，接上 webhook 后的库状态。
  // 人一直停在本页不切走，webhook 不会推到前端，仍需手动刷新。
  //人从别的页（比如 GitHub）回到这个标签时，重新去后端拉安装列表和仓库列表。

  useEffect(() => {//组件挂上后执行一次，用来注册浏览器事件。后面依赖变了会先清理再重新注册
    function refreshAfterReturning() {//定义回来时要跑的函数。还没调用，只是准备好给监听器用。
      if (document.visibilityState !== 'visible') return
      // 如果现在是藏着的，直接结束，不拉数据。只有重新看得见，才往下 invalidateQueries。
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubInstallations(teamId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubTeamRepositories(teamId) })
    }
    document.addEventListener('visibilitychange', refreshAfterReturning)
    window.addEventListener('focus', refreshAfterReturning)
    return () => {//清理函数
      document.removeEventListener('visibilitychange', refreshAfterReturning)
      window.removeEventListener('focus', refreshAfterReturning)
    }
  }, [queryClient, teamId])

  /**
   * 后端回调回跳约定（请与后端对齐）：
   * GET /integrations/github/callback 处理完后 302 →
   * 成功：/app/integrations/github?teamId={id}&installed=1
   * 归属冲突：/app/integrations/github?teamId={id}&installed=0&conflict=GITHUB_INSTALLATION_TEAM_CONFLICT&message=...
   */
  const handledRef = useRef(false)
  // 处理 GitHub 安装完成页面回跳
  useEffect(() => {
    // 归属冲突回跳：同一 GitHub 账号已绑定其他团队，后端 302 带回 conflict 与 message
    const conflict = searchParams.get('conflict')
    const conflictMessage = searchParams.get('message')
    if (conflict) {
      if (handledRef.current) return
      handledRef.current = true //ref防抖操作
      message.error(conflictMessage || 'GitHub 安装未完成，请稍后重试或联系管理员')
      // 复制一份当前所有 url 查询参数，得到一份副本对象next。
      // 清掉 conflict / message / installed，避免刷新反复弹 toast
      const next = new URLSearchParams(searchParams)
      next.delete('conflict')
      next.delete('message')
      next.delete('installed')
      // 把一次性回调参数删掉。
      setSearchParams(next, { replace: true })
      // 默认模式:用户点浏览器左上角回退按钮，会退回到记录 A，url 又出现conflict，又会触发 useEffect，再次弹出提示，bug。
      //替换模式:不新增历史，直接覆盖当前这一条历史记录
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubInstallations(teamId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubTeamRepositories(teamId) })//302负责跳转页面
      return
    }

    const installed = searchParams.get('installed')
    if (installed !== '1') return
    if (handledRef.current) return
    handledRef.current = true //ref防抖操作
    message.success('GitHub App 安装/授权已完成')
    // 复制一份当前所有 url 查询参数，得到一份副本对象next。
    // 清掉 installed，避免刷新反复弹 toast
    const next = new URLSearchParams(searchParams)
    next.delete('installed')
    // 把 key 为installed的参数删掉。
    setSearchParams(next, { replace: true })
    // 默认模式:用户点浏览器左上角回退按钮，会退回到记录 A，url 又出现installed=1，又会触发 useEffect，再次弹出「安装完成」提示，bug。
    //替换模式:不新增历史，直接覆盖当前这一条历史记录

    // TODO[后端联调] 安装成功后刷新 installations / repositories 列表
  // 已冻结见 docs：installed=1 后提示一次、invalidate 列表、清理 query。清除旧缓存
    void queryClient.invalidateQueries({ queryKey: queryKeys.githubInstallations(teamId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.githubTeamRepositories(teamId) })//302负责跳转页面
  }, [searchParams, setSearchParams, message, queryClient, teamId])//searchParams,teamId
  // searchParams:url 查询参数对象。
  // 只要浏览器 url 问号后面参数发生变化，searchParams 引用就会变，触发 useEffect 执行。
  //主要是看searchParams的变化,其余那两个引用一直不变

  /**
   * 「安装Github App」核心 mutation
   * ----------------------------------------------------------------------------
   * mutationFn → githubApi.createInstallation(teamId)
   *   POST /api/teams/{teamId}/integrations/github/installations
   *
   * onSuccess → 校验 installationUrl → 整页跳转 GitHub
   * onError   → toast 展示后端错误（403 非 Owner 等）
   * ----------------------------------------------------------------------------
   */
  // 修改类 / 触发式网络请求
  const installMutation = useGithubInstallRedirect(teamId)
  const deleteMutation = useDeleteGithubInstallation(teamId)

  /** 按钮点击入口：仅触发 mutation，业务全在上面 */
  function handleInstallApp() {
    installMutation.mutate()
  }//触发网络请求返回的信息,弹窗

  /**
   * 卡片「解除关联」：确认后 DELETE 当前 Installation。
   * 只解除本团队本地关联，不会在 GitHub 卸载 Qgents App。
   */
  function handleDisconnect(inst: GithubInstallation) {
    modal.confirm({//antd确认弹窗,一个对象
      title: '解除关联',
      content:
        '将解除此 GitHub 账号/组织与当前 Qgents 团队的关联，不会在 GitHub 卸载 Qgents App。请先解绑该 Installation 下的项目仓库；解除后可在其他团队重新连接。',
      okText: '确认解除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(inst.id)//确认之后触发的回调函数
    })
  }

  /**
   * 卡片「在 GitHub 卸载 Qgents App」：打开 GitHub Installation 管理页。
   * 不调用 DELETE。用户在 GitHub 卸载后，靠 webhook 把状态标成 DELETED。
   */
  function handleOpenGithubUninstall(inst: GithubInstallation) {
    const configureUrl = githubInstallationConfigureUrl(inst)
    if (!configureUrl) {
      message.error('缺少 GitHub Installation 数字 ID，无法打开 GitHub 管理页。')
      return
    }
    modal.confirm({
      title: '在 GitHub 卸载 Qgents App',
      content:
        '将跳转至 GitHub 管理页。卸载后，Qgents 将立即失去该账号或组织下仓库的访问权限；现有项目记录会保留，但无法继续同步或推送。',
      okText: '前往 GitHub',
      cancelText: '取消',
      onOk: () => {
        const popup = window.open(configureUrl, '_blank', 'noopener,noreferrer')
        if (!popup) {
          message.error('浏览器拦截了新窗口，请允许弹窗后再试')
        }
      },
    })
  }

  /** GET 团队已安装的 GitHub App 列表 */
  const installationsQuery = useQuery({
    queryKey: queryKeys.githubInstallations(teamId),//缓存地址
    queryFn: () => githubApi.listInstallations(teamId),//请求函数,返回成功之后是一个对象数组
    enabled: Boolean(teamId),//是否启用这个请求,true才执行
  })

  /** GET 团队已授权仓库（用于卡片上统计仓库数） */
  const reposQuery = useQuery({
    queryKey: queryKeys.githubTeamRepositories(teamId),
    queryFn: () => githubApi.listTeamRepositories(teamId),
    enabled: Boolean(teamId),
  })

  const installations = installationsQuery.data ?? []
  const allRepos = reposQuery.data ?? []
  // webhook 在 GitHub 卸载后常把记录留在列表里，只把 status 改成 DELETED。
  // 本页「解除关联」成功后本地记录会被删掉。「已关联」只数还能用的安装。
  const associatedCount = installations.filter((inst) => inst.status !== 'DELETED').length
  // 计算某一条 GitHub App 安装记录，绑定了多少个授权仓库
  function repoCountOf(inst: GithubInstallation): number {
    if (typeof inst.authorizedRepoCount === 'number') return inst.authorizedRepoCount
    return countAuthorizedRepositories(inst.id, allRepos)//传入全部仓库作为参数进行一个筛选
  }

  return (
    <>
      {/* 入口来自团队详情「github集成」，提供返回，避免只能靠浏览器后退 */}
      <Link to={PATHS.teamDetail(teamId)}>
        <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0, marginBottom: 16 }}>
          返回团队详情
        </Button>
      </Link>

      <header
        style={{
          marginBottom: 24,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <Title level={2} style={{ marginTop: 0, marginBottom: 8 }}>
            GitHub 集成
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            团队级 GitHub App 授权与项目仓库绑定。代码操作由服务端受控执行，前端不持有 Git 凭据。
            {' · '}
            teamId: <Text code>{teamId}</Text>
          </Paragraph>
        </div>

        {/*
          安装按钮（Team Owner）：只负责新装
          点击 → POST .../installations → 跳转 /apps/{slug}/installations/new
          已装过的账号也走 new，由 GitHub 提示 already installed；不进 Configure
        */}
        <div style={{ textAlign: 'right', maxWidth: 320 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={installMutation.isPending}
            onClick={handleInstallApp}
          >
            安装Github App
          </Button>
          <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            一个 GitHub 账号只能授权给一个团队。每次都跳转 GitHub 新装页；已安装的账号由 GitHub
            提示 already installed，不会重复绑定。
          </Paragraph>
        </div>
      </header>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="GitHub App 以团队为边界授权。安装时可选择个人账号或组织，并勾选授权仓库；Qgents 只访问你明确选择的仓库。"
      />

      <Card
        title="已安装的 GitHub App"
        extra={
          <Text type="secondary">当前团队已关联 {associatedCount} 个安装</Text>
        }
        style={{ marginBottom: 16 }}
      >
        {installationsQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : installationsQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message={formatApiError(installationsQuery.error)}
            action={
              <Button size="small" onClick={() => void installationsQuery.refetch()}>
                重试
              </Button>
            }
          />
        ) : installations.length === 0 ? (
          <Empty description="您还没有任何安装的 GitHub App，请先安装">
            <Paragraph type="secondary">
              点击右上角「安装Github App」，在 GitHub 选择个人或组织并勾选仓库。
            </Paragraph>
          </Empty>
        ) : (
          <Row gutter={[16, 16]}>
            {installations.map((inst) => (
              <Col xs={24} md={12} key={inst.id}>
                <Card
                  size="small"
                  styles={{
                    body: {
                      background: token.colorBgContainer,
                    },
                  }}
                  style={{
                    borderColor: token.colorBorder,
                    height: '100%',
                  }}
                >
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                    <Space align="start">
                      <GithubOutlined style={{ fontSize: 28, marginTop: 4 }} />
                      <div>
                        <Space wrap>
                          <Text strong style={{ fontSize: 16 }}>
                            {inst.accountLogin}
                          </Text>
                          {statusTag(inst.status)}
                        </Space>
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary">
                            {accountTypeLabel(inst.accountType)}
                            {' · '}
                            {repoCountOf(inst)} 个仓库已授权
                          </Text>
                        </div>
                        <Text
                          type="secondary"
                          style={{ display: 'block', marginTop: 8, fontSize: 12 }}
                        >
                          安装于 {formatGithubDateTime(inst.installedAt)}
                        </Text>
                      </div>
                    </Space>
                  </Space>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                    <Button
                      type="default"
                      icon={<EyeOutlined />}
                      style={{ flex: '1 1 120px' }}
                      onClick={() =>
                        navigate(PATHS.githubInstallationRepos(teamId, inst.id))
                      }
                    >
                      查看仓库
                    </Button>
                    {inst.status !== 'DELETED' ? (
                      <>
                        <Button
                          danger
                          icon={<DisconnectOutlined />}
                          style={{ flex: '1 1 140px' }}
                          loading={deleteMutation.isPending && deleteMutation.variables === inst.id}
                          onClick={() => handleDisconnect(inst)}
                        >
                          解除关联
                        </Button>
                        <Button
                          icon={<ExportOutlined />}
                          style={{ flex: '1 1 180px' }}
                          onClick={() => handleOpenGithubUninstall(inst)}
                        >
                          在 GitHub 卸载 Qgents App
                        </Button>
                      </>
                    ) : null}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>

      <Card title="说明" type="inner">
        <ul style={{ margin: 0, paddingLeft: 20, color: token.colorTextSecondary }}>
          <li>
            GitHub App 授权为<strong>团队级</strong>；一次安装对应一个<strong>个人账号</strong>或
            <strong>组织</strong>（安装时在 GitHub 上选择）。
          </li>
          <li>
            「查看仓库」进入独立页面；「解除关联」只解除本团队与该 Installation 的关联，不会在
            GitHub 卸载 App；「在 GitHub 卸载 Qgents App」跳转 GitHub 管理页，由用户在 GitHub 侧卸载。
            仓库后的「绑定该仓库到项目」会进入本团队项目列表（Owner 可见全部项目）。
          </li>
          <li>
            点击「安装Github App」→ POST 获取 <code>installationUrl</code> → 跳转 GitHub；回调由后端
            <code> GET /integrations/github/callback </code>处理。
          </li>
        </ul>
      </Card>
    </>
  )
}
