import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackTop, Button, Card, ConfigProvider, Empty, List, Space, Tag, Typography, App, Descriptions } from 'antd'
import { LeftOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useMergeRequest, useTestRun, useDryRunReport, useTestsets } from '@/hooks'
import { useTask } from '@/hooks/task-model'
import type { TestRun, LocalRunHistoryItem, Testset } from '@/types/testset'
import { githubApi, projectApi } from '@/api'
import { queryKeys } from '@/query'
import { PATHS } from '@/routes/paths'
import { readRunHistory, pushRunHistory, removeRunHistory } from './runHistory'
import TestRunCreateModal from './TestRunCreateModal'
import styles from './QualityGateReviewPage.module.scss'

const { Title, Text, Paragraph } = Typography

const pageTheme = {
  algorithm: undefined,
  token: {
    colorPrimary: '#0d9b9b',
    colorBgBase: '#ffffff',
    colorText: '#12213d',
    colorTextSecondary: '#6d7d95',
    colorBorder: '#e4eaf2',
    borderRadius: 8,
  },
}

/**
 * 质量门禁审查页。
 * 入口：MR 与质量门禁 → 流程图点击「质量门禁」节点
 *
 * 注意：后端本轮未实现 GET /test-runs 和 GET /dry-runs 列表接口（P1+），
 * 按文档要求使用 localStorage 维护本设备运行历史。
 * 当前运行状态通过单条查询（useTestRun / useDryRunReport）轮询获取。
 */
export default function QualityGateReviewPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()

  const mergeRequestId = searchParams.get('mr')?.trim() || undefined

  // 弹窗状态
  const [testRunModalOpen, setTestRunModalOpen] = useState(false)

  // 本地运行历史（从 localStorage 读取）
  const [localRuns, setLocalRuns] = useState<LocalRunHistoryItem[]>(() => readRunHistory(projectId))

  // 选中的历史记录 ID（为 null 时默认显示最新一条）
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // MR 是可选的：质量门禁操作页不依赖 MR，MR 存在时额外加载
  const mrQuery = useMergeRequest(projectId, mergeRequestId ?? '')

  // 加载仓库列表（用于 DryRun/TestRun 创建表单）
  const reposQuery = useQuery({
    queryKey: queryKeys.projectRepositories(projectId),
    queryFn: () => githubApi.listProjectRepositories(projectId),
    enabled: Boolean(projectId),
  })

  const mr = mrQuery.data
  const repositories = reposQuery.data ?? []

  // 创建成功回调：写入 localStorage 并刷新状态
  const handleTestRunCreated = useCallback((run: TestRun) => {
    const item: LocalRunHistoryItem = {
      kind: 'TEST_RUN',
      id: run.id,
      repositoryId: run.repositoryId,
      createdAt: run.createdAt,
      label: `Test run · ${run.testsetIds.length} 个测试集`,
    }
    setLocalRuns(pushRunHistory(projectId, item))
    message.success('Test Run 已创建')
  }, [projectId, message])

  // 删除本地历史项
  const handleDeleteRun = useCallback((runId: string) => {
    setLocalRuns(removeRunHistory(projectId, runId))
  }, [projectId])

  function goBack() {
    navigate(PATHS.projectTestset(projectId))
  }

  // MR 查询仅在有 mergeRequestId 时启用；页面核心功能不依赖 MR
  const isMrError = !!mergeRequestId && mrQuery.isError

  if (isMrError) {
    return (
      <ConfigProvider theme={pageTheme}>
        <div className={styles.page}>
          <div className={styles.state}>
            <Empty description={`MR 加载失败：${mrQuery.error?.message ?? '未知错误'}`}>
              <Button onClick={() => void mrQuery.refetch()}>重试</Button>
              <Button onClick={goBack}>返回</Button>
            </Empty>
          </div>
        </div>
      </ConfigProvider>
    )
  }

  return (
    <ConfigProvider theme={pageTheme}>
      <div className={styles.page}>
        <BackTop />
        <button type="button" className={styles.backLink} onClick={goBack}>
          <LeftOutlined /> 返回质量门禁页
        </button>

        <header className={styles.header}>
          <div>
            <Title level={2} className={styles.title}>
              质量门禁
              {mergeRequestId && mr ? (
                <Tag color="blue" style={{ marginLeft: 8 }}>
                  MR: {mr.number}
                </Tag>
              ) : null}
            </Title>
            <Paragraph className={styles.subtitle}>
              {mergeRequestId && !mr ? '正在加载 MR…' : 'Dry Run 由后端预检流程自动触发；此处可手动发起测试运行。'}
            </Paragraph>
          </div>
          <Space>
            <Button onClick={() => setTestRunModalOpen(true)} disabled={repositories.length === 0}>
              运行测试
            </Button>
          </Space>
        </header>

        <div className={styles.runRow}>
          <div className={styles.runColumn}>
            <CurrentRunCard
              projectId={projectId}
              localRuns={localRuns}
              selectedRunId={selectedRunId}
            />
          </div>
          <div className={styles.runColumn}>
            <HistoryRunsCard
              localRuns={localRuns}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
              onDelete={handleDeleteRun}
            />
          </div>
        </div>

        {/* Test Run 创建弹窗 */}
        <TestRunCreateModal
          open={testRunModalOpen}
          projectId={projectId}
          repositories={repositories}
          onClose={() => setTestRunModalOpen(false)}
          onCreated={handleTestRunCreated}
        />
      </div>
    </ConfigProvider>
  )
}

interface CurrentRunCardProps {
  projectId: string
  localRuns: LocalRunHistoryItem[]
  selectedRunId: string | null
}

function CurrentRunCard({ projectId, localRuns, selectedRunId }: CurrentRunCardProps) {
  // 根据选中 ID 或默认取最新一条
  const current = useMemo(() => {
    if (selectedRunId) {
      return localRuns.find(r => r.id === selectedRunId) ?? null
    }
    return localRuns[0] ?? null
  }, [localRuns, selectedRunId])

  // 获取运行状态（单条接口轮询）
  const testRunQuery = useTestRun(
    projectId,
    current?.kind === 'TEST_RUN' ? current.id : undefined,
  )
  const dryRunQuery = useDryRunReport(
    projectId,
    current?.kind === 'DRY_RUN' ? current.id : undefined,
  )

  // 加载测试集用于名称映射
  const { data: allTestsets = [] } = useTestsets(projectId, {})
  const testsetNameMap = useMemo(() => {
    const map = new Map<string, string>()
    allTestsets.forEach((t: Testset) => map.set(t.id, t.name))
    return map
  }, [allTestsets])

  // 加载项目成员用于昵称映射
  const { data: members = [] } = useQuery({
    queryKey: ['projects', projectId, 'members'],
    queryFn: () => projectApi.listMembers(projectId),
    enabled: Boolean(projectId),
  })
  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>()
    members.forEach((m) => map.set(m.userId, m.displayName || m.userId))
    return map
  }, [members])

  // ============ Dry Run / TestRun 数据 ============
  const report = dryRunQuery.data
  const testRunData = testRunQuery.data

  // --- Dry Run 计算 ---
  const dryRunDurationText = useMemo(() => {
    if (!report) return '—'
    const terminalStatuses = ['PASSED', 'FAILED', 'CANCELLED']
    const isTerminal = terminalStatuses.includes(report.status as string)
    if (report.durationSeconds != null) {
      return `${report.durationSeconds}s`
    }
    if (report.startedAt && report.finishedAt) {
      const ms = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()
      if (Number.isFinite(ms) && ms > 0) return `${Math.round(ms / 1000)}s`
      if (isTerminal) return '0s'
      return '进行中…'
    }
    if (isTerminal) return '0s'
    if (report.startedAt) {
      return '进行中…'
    }
    return '—'
  }, [report])

  const dryRunStatusColor = useMemo(() => {
    if (!report) return 'default'
    switch (report.status) {
      case 'PASSED': return 'success'
      case 'FAILED': return 'error'
      case 'CONFLICT': return 'warning'
      case 'CANCELLED': return 'default'
      case 'RUNNING': return 'processing'
      default: return 'default'
    }
  }, [report])

  // --- TestRun 计算 ---
  const testRunDurationText = useMemo(() => {
    if (!testRunData) return '—'
    const terminalStatuses = ['PASSED', 'FAILED', 'CANCELLED']
    const isTerminal = terminalStatuses.includes(testRunData.status as string)
    if (testRunData.startedAt && testRunData.finishedAt) {
      const ms = new Date(testRunData.finishedAt).getTime() - new Date(testRunData.startedAt).getTime()
      if (Number.isFinite(ms) && ms > 0) return `${Math.round(ms / 1000)}s`
      if (isTerminal) return '0s'
      return '进行中…'
    }
    if (isTerminal) return '0s'
    if (testRunData.startedAt) {
      return '进行中…'
    }
    return '—'
  }, [testRunData])

  const testRunStatusColor = useMemo(() => {
    if (!testRunData) return 'default'
    const status: string = testRunData.status as string
    switch (status) {
      case 'PASSED': return 'success'
      case 'FAILED': return 'error'
      case 'CANCELLED': return 'default'
      case 'RUNNING': return 'processing'
      case 'QUEUED': return 'processing'
      case 'CONFLICT': return 'warning'
      default: return 'default'
    }
  }, [testRunData])

  // --- 获取关联任务名称 ---
  const testRunTaskId = testRunData?.taskId ?? null
  const dryRunTaskId = report?.taskId ?? null
  const activeTaskId = testRunTaskId || dryRunTaskId

  const taskQuery = useTask(projectId, activeTaskId ?? '')

  const taskName = useMemo(() => {
    if (!activeTaskId) return null
    return taskQuery.data?.title ?? null
  }, [activeTaskId, taskQuery.data])

  // --- 发起人昵称解析 ---
  const testRunCreatorName = useMemo(() => {
    if (!testRunData?.createdBy) return '—'
    return memberNameMap.get(testRunData.createdBy) || testRunData.createdBy
  }, [testRunData?.createdBy, memberNameMap])

  const dryRunCreatorName = useMemo(() => {
    if (!report?.createdBy) return '—'
    return memberNameMap.get(report.createdBy) || report.createdBy
  }, [report?.createdBy, memberNameMap])

  // --- 测试集名称 ---
  const testRunTestsetNames = useMemo(() => {
    if (!testRunData) return '无'
    return (testRunData.testsetIds || [])
      .map((id) => testsetNameMap.get(id) ?? id.slice(0, 8))
      .join('、') || '无'
  }, [testRunData, testsetNameMap])

  const dryRunTestsetNames = useMemo(() => {
    if (!report) return '无'
    return (report.testsetIds || [])
      .map((id) => testsetNameMap.get(id) ?? id.slice(0, 8))
      .join('、') || '无'
  }, [report, testsetNameMap])

  const currentStatus: string | undefined =
    current?.kind === 'TEST_RUN'
      ? testRunQuery.data?.status
      : current?.kind === 'DRY_RUN'
        ? dryRunQuery.data?.status
        : undefined

  const isActive = currentStatus === 'QUEUED' || currentStatus === 'RUNNING'
  const isLoading = testRunQuery.isLoading || dryRunQuery.isLoading

  // ============ 渲染 ============
  const isDryRun = current?.kind === 'DRY_RUN' && report
  const isTestRun = current?.kind === 'TEST_RUN' && testRunData

  return (
    <Card className={styles.runCard}>
      <Title level={5} className={styles.runCardTitle}>当前运行</Title>
      {localRuns.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="尚未发起或选择运行。用右上角发起测试 / Dry-run。"
        />
      ) : current && isDryRun ? (
        <div>
          <div className={styles.currentRunItem} style={{ marginBottom: 12 }}>
            <Tag color="purple">Dry-run</Tag>
            <Text strong>{report!.id.slice(0, 8)}</Text>
            <Tag color={dryRunStatusColor}>{report!.status}</Tag>
          </div>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="本轮测试集">
              {dryRunTestsetNames}
            </Descriptions.Item>
            <Descriptions.Item label="发起人">
              {dryRunCreatorName}
            </Descriptions.Item>
            <Descriptions.Item label="源分支">
              <Tag>{report!.sourceRef}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="目标分支">
              <Tag color="blue">{report!.targetBranch}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="引用任务">
              {taskName || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="运行状态">
              <Tag color={dryRunStatusColor}>{report!.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="开始时间">
              {report!.startedAt ? new Date(report!.startedAt).toLocaleString() : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="运行时长">
              {dryRunDurationText}
            </Descriptions.Item>
          </Descriptions>
        </div>
      ) : current && isTestRun ? (
        <div>
          <div className={styles.currentRunItem} style={{ marginBottom: 12 }}>
            <Tag color="blue">测试运行</Tag>
            <Text strong>{testRunData!.id.slice(0, 8)}</Text>
            <Tag color={testRunStatusColor}>{testRunData!.status}</Tag>
          </div>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="本轮测试集">
              {testRunTestsetNames}
            </Descriptions.Item>
            <Descriptions.Item label="发起人">
              {testRunCreatorName}
            </Descriptions.Item>
            <Descriptions.Item label="引用分支">
              {testRunData!.ref ? <Tag>{testRunData!.ref}</Tag> : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="引用任务">
              {taskName || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="运行状态">
              <Tag color={testRunStatusColor}>{testRunData!.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="开始时间">
              {testRunData!.startedAt ? new Date(testRunData!.startedAt).toLocaleString() : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="运行时长">
              {testRunDurationText}
            </Descriptions.Item>
          </Descriptions>
        </div>
      ) : current ? (
        <div className={styles.currentRunList}>
          <div className={styles.currentRunItem}>
            <Tag color={current.kind === 'TEST_RUN' ? 'processing' : 'purple'}>
              {current.kind === 'TEST_RUN' ? '测试运行' : 'Dry-run'}
            </Tag>
            <Text strong>{current.id.slice(0, 8)}</Text>
            <Text type="secondary">
              {isLoading ? '加载状态…' : currentStatus ?? '已提交'}
            </Text>
            {isActive ? (
              <Tag color="processing" style={{ marginLeft: 4 }}>运行中</Tag>
            ) : currentStatus ? (
              <Tag color={currentStatus === 'PASSED' ? 'success' : 'default'} style={{ marginLeft: 4 }}>
                {currentStatus}
              </Tag>
            ) : null}
          </div>
        </div>
      ) : (
        <Empty description="暂无运行中的任务" />
      )}
    </Card>
  )
}

interface HistoryRunsCardProps {
  localRuns: LocalRunHistoryItem[]
  selectedRunId: string | null
  onSelect: (runId: string | null) => void
  onDelete: (runId: string) => void
}

function HistoryRunsCard({ localRuns, selectedRunId, onSelect, onDelete }: HistoryRunsCardProps) {
  const sorted = useMemo(() => {
    return [...localRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [localRuns])

  return (
    <Card className={`${styles.runCard} ${styles.historyCard}`}>
      <Title level={5} className={styles.runCardTitle}>本设备最近运行</Title>
      <Text type="secondary" className={styles.sideHint}>
        仅保存在本浏览器，不是跨设备权威历史。
      </Text>
      {sorted.length === 0 ? (
        <Empty description="暂无运行记录" />
      ) : (
        <div className={styles.historyListScroll}>
          <List
            size="small"
            dataSource={sorted}
            renderItem={(item) => {
              const isSelected = item.id === selectedRunId
              return (
                <List.Item
                  className={isSelected ? styles.selectedListItem : undefined}
                  onClick={() => onSelect(isSelected ? null : item.id)}
                  actions={[
                    <Button
                      key="delete"
                      type="link"
                      size="small"
                      danger
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(item.id)
                        if (selectedRunId === item.id) onSelect(null)
                      }}
                    >
                      删除
                    </Button>,
                  ]}
                >
                  <div className={styles.recentRunItem}>
                    <Tag color={item.kind === 'TEST_RUN' ? 'blue' : 'purple'}>
                      {item.kind === 'TEST_RUN' ? 'test-run' : 'dry-run'}
                    </Tag>
                    <Text strong>{item.label}</Text>
                    <Text type="secondary" className={styles.recentRunStatus}>
                      {new Date(item.createdAt).toLocaleString()}
                    </Text>
                  </div>
                </List.Item>
              )
            }}
          />
        </div>
      )}
    </Card>
  )
}
