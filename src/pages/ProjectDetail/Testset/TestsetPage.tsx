import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Button,
  Card,
  ConfigProvider,
  Empty,
  Spin,
  Tag,
  Typography,
  Row,
  Col,
  Space,
} from 'antd'
import {
  DatabaseOutlined,
  PlayCircleOutlined,
  MergeOutlined,
  SettingOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { githubApi, projectApi } from '@/api'
import { useTestsets } from '@/hooks'
import { PATHS } from '@/routes/paths'
import { queryKeys } from '@/query'
import { MergeRequestTab } from '../MergeRequestTab'
import { QualityGateConfigDrawer } from './QualityGateConfigDrawer'
import styles from './TestsetPage.module.scss'

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
 * 质量门禁 & MR 枢纽页（菜单"质量门禁和 MR"对应）。
 * 展示三个项目级入口：
 *  - ① Testset 管理（/testset/manage）
 *  - ② 质量门禁审查 & Dry Run / Test Run（/quality-gate）
 *  - ③ MR 列表与合并
 * 以及右上角"分支策略与门禁"配置抽屉。
 *
 * 流程图（FlowStepper）放在 TaskDetailPage，属于任务级，不在这里展示。
 */
export function TestsetPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [, setSearchParams] = useSearchParams()

  const [configOpen, setConfigOpen] = useState(false)

  const projectQuery = useQuery({
    queryKey: queryKeys.projects(projectId),
    queryFn: () => projectApi.getById(projectId),
    enabled: Boolean(projectId),
  })
  const isAdmin = projectQuery.data?.role === 'PROJECT_ADMIN'

  // 项目概览：testset 计数
  const testsetsQuery = useTestsets(projectId, {})
  const testsets = testsetsQuery.data ?? []
  const testsetCount = testsets.length
  const enabledTestsetCount = useMemo(
    () => testsets.filter((t) => t.status === 'ENABLED').length,
    [testsets],
  )

  const reposQuery = useQuery({
    queryKey: queryKeys.projectRepositories(projectId),
    queryFn: () => githubApi.listProjectRepositories(projectId),
    enabled: Boolean(projectId),
  })
  const repositories = reposQuery.data ?? []

  const isLoading = reposQuery.isLoading || projectQuery.isLoading || testsetsQuery.isLoading

  if (isLoading) {
    return (
      <ConfigProvider theme={pageTheme}>
        <div className={styles.page}>
          <div className={styles.state}>
            <Spin />
          </div>
        </div>
      </ConfigProvider>
    )
  }

  if (reposQuery.isError) {
    return (
      <ConfigProvider theme={pageTheme}>
        <div className={styles.page}>
          <div className={styles.state}>
            <Empty description={reposQuery.error?.message ?? '加载失败'}>
              <Button onClick={() => void reposQuery.refetch()}>重新加载</Button>
            </Empty>
          </div>
        </div>
      </ConfigProvider>
    )
  }

  return (
    <ConfigProvider theme={pageTheme}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <Title level={2} className={styles.title}>
              质量门禁和 MR
            </Title>
            <Text type="secondary">
              管理 Testset、手动触发 Dry Run / Test Run、查看和合并项目 MR
            </Text>
          </div>
          <Space>
            <Button
              icon={<SettingOutlined />}
              onClick={() => setConfigOpen(true)}
              disabled={!isAdmin}
              title={isAdmin ? '配置分支质量门禁' : '仅 Project Admin 可配置'}
            >
              分支质量门禁
            </Button>
          </Space>
        </header>

        {/* 三个入口卡片 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={8}>
            <Card
              className={styles.entryCard}
              hoverable
              onClick={() => {
                void navigate(PATHS.projectTestsetsManage(projectId))
              }}
              bodyStyle={{ padding: 20, minHeight: 140 }}
            >
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space size={12} align="start" className={styles.entryRow}>
                  <DatabaseOutlined
                    style={{
                      fontSize: 26,
                      color: '#0d9b9b',
                      paddingTop: 2,
                      flexShrink: 0,
                    }}
                  />
                  <div className={styles.entryBody}>
                    <Text strong style={{ fontSize: 16, display: 'block' }}>
                      Testset 管理
                    </Text>
                    <Paragraph type="secondary" style={{ margin: '6px 0 8px', fontSize: 13 }}>
                      创建、编辑、启用/停用测试集（Testset）。
                    </Paragraph>
                    <Space size={8} wrap>
                      <Tag color="blue">{testsetCount} 个测试集</Tag>
                      <Tag color="success">{enabledTestsetCount} 个已启用</Tag>
                    </Space>
                  </div>
                  <ArrowRightOutlined
                    className={styles.entryArrow}
                    style={{ color: '#6d7d95', flexShrink: 0, paddingTop: 4 }}
                  />
                </Space>
              </Space>
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={8}>
            <Card
              className={styles.entryCard}
              hoverable
              onClick={() => {
                void navigate(PATHS.projectQualityGate(projectId))
              }}
              bodyStyle={{ padding: 20, minHeight: 140 }}
            >
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space size={12} align="start" className={styles.entryRow}>
                  <PlayCircleOutlined
                    style={{
                      fontSize: 26,
                      color: '#0d9b9b',
                      paddingTop: 2,
                      flexShrink: 0,
                    }}
                  />
                  <div className={styles.entryBody}>
                    <Text strong style={{ fontSize: 16, display: 'block' }}>
                      质量门禁审查
                    </Text>
                    <Paragraph type="secondary" style={{ margin: '6px 0 8px', fontSize: 13 }}>
                      手动触发 Dry Run / Test Run、查看本地运行历史与报告。
                    </Paragraph>
                    <Space size={8}>
                      <Tag color="geekblue">新建 Dry Run</Tag>
                      <Tag color="purple">新建 Test Run</Tag>
                    </Space>
                  </div>
                  <ArrowRightOutlined
                    className={styles.entryArrow}
                    style={{ color: '#6d7d95', flexShrink: 0, paddingTop: 4 }}
                  />
                </Space>
              </Space>
            </Card>
          </Col>

          <Col xs={24} sm={24} lg={8}>
            <Card className={styles.entryCard} bodyStyle={{ padding: 20, minHeight: 140 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space size={12} align="start" className={styles.entryRow}>
                  <MergeOutlined
                    style={{
                      fontSize: 26,
                      color: '#0d9b9b',
                      paddingTop: 2,
                      flexShrink: 0,
                    }}
                  />
                  <div className={styles.entryBody}>
                    <Text strong style={{ fontSize: 16, display: 'block' }}>
                      MR 合并管理
                    </Text>
                    <Paragraph type="secondary" style={{ margin: '6px 0 8px', fontSize: 13 }}>
                      查看项目所有 MR；Project Admin 在质量门禁通过后执行合并。
                    </Paragraph>
                    <Space size={8} wrap className={styles.entryTags}>
                      <Tag color={isAdmin ? 'success' : 'default'}>
                        {isAdmin ? '可执行合并' : '仅查看'}
                      </Tag>
                      <Tag color="cyan">{repositories.length} 个仓库</Tag>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setSearchParams({ tab: 'mr', status: 'OPEN' }, { replace: true })
                          window.requestAnimationFrame(() => {
                            document.getElementById('project-mr-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          })
                        }}
                      >
                        查看进行中 MR
                      </Button>
                    </Space>
                  </div>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>

        {/* MR 列表（列表项不可点击，合并按钮在行内操作列） */}
        <div id="project-mr-list" className={styles.mrTab}>
          <MergeRequestTab
            projectId={projectId}
            repositories={repositories}
            isAdmin={isAdmin}
          />
        </div>

        <QualityGateConfigDrawer
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          projectId={projectId}
          isAdmin={isAdmin}
          repositories={repositories}
          testsets={testsets}
        />
      </div>
    </ConfigProvider>
  )
}
