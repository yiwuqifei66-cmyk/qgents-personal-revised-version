import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { isTestsetEnabled } from '@/api/testset'
import { useQualityGate, useUpdateQualityGate } from '@/hooks/qualityGate'
import { useRemoteBranches } from '@/hooks/remoteBranch'
import { formatApiError } from '@/utils/formatApiError'
import type { ProjectBoundRepository } from '@/types/github'
import type { Testset } from '@/types/testset'
import type { QualityGateUpdateInput } from '@/types/qualityGate'
import styles from './TestsetPage.module.scss'

const { Text } = Typography

/**
 * 分支策略与质量门禁配置。
 * 入口：Testset 页右上「分支策略与门禁」。
 * 仅 PROJECT_ADMIN 可编辑；普通成员只读展示（或后端 403 时提示无权限）。
 * 强制 Testset（requiredTestsetIds）候选仅为同一仓库、已启用的 Testset。
 */
export function QualityGateConfigDrawer({
  open,
  onClose,
  projectId,
  isAdmin,
  repositories,
  testsets,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  isAdmin: boolean
  repositories: ProjectBoundRepository[]
  testsets: Testset[]
}) {
  const { message } = App.useApp()
  const [repositoryId, setRepositoryId] = useState<string | undefined>()
  const [branch, setBranch] = useState<string | undefined>()

  const remoteBranchesQuery = useRemoteBranches(projectId, repositoryId ?? '')
  const remoteBranches = useMemo(() => remoteBranchesQuery.data ?? [], [remoteBranchesQuery.data])
  const gateQuery = useQualityGate(projectId, repositoryId ?? '', branch ?? '')
  const updateGate = useUpdateQualityGate(projectId)

  const [gateForm] = Form.useForm<QualityGateUpdateInput>()

  // 换仓库时用默认分支作为目标分支；不得回退 'main'，仓库未初始化时留空让用户/校验感知
  function handleRepoChange(value: string | undefined): void {
    setRepositoryId(value)
    setBranch(undefined)
  }

  useEffect(() => {
    if (!open) return
    if (!repositoryId && repositories.length > 0) {
      const first = repositories[0]
      console.log('[QualityGate] 选择仓库', {
        id: first.id,
        repositoryId: first.repositoryId,
        fullName: first.fullName,
      })
      setRepositoryId(first.id)
      setBranch(undefined)
    }
  }, [open, repositories, repositoryId])

  useEffect(() => {
    if (!repositoryId || remoteBranches.length === 0) {
      setBranch(undefined)
      return
    }
    setBranch((current) => {
      if (current && remoteBranches.some((item) => item.name === current)) return current
      return remoteBranches.find((item) => item.isProjectDefault)?.name
        ?? remoteBranches.find((item) => item.isGithubDefault)?.name
        ?? remoteBranches[0].name
    })
  }, [repositoryId, remoteBranches])

  useEffect(() => {
    if (!gateQuery.data) return
    gateForm.setFieldsValue({ requiredTestsetIds: gateQuery.data.requiredTestsetIds })
  }, [gateQuery.data, gateForm])

  async function saveGate(values: QualityGateUpdateInput): Promise<void> {
    if (!repositoryId || !branch) {
      message.error('请先选择仓库并确保项目默认基准分支已设置（仓库未初始化时无法保存质量门禁）')
      return
    }
    try {
      await updateGate.mutateAsync({
        repositoryId,
        branch,
        input: {
          requiredChecks: gateQuery.data?.requiredChecks ?? [],
          requiredTestsetIds: values.requiredTestsetIds ?? [],
        },
      })
      message.success('已保存质量门禁')
    } catch (error) {
      message.error(formatApiError(error))
    }
  }

  const enabledTestsets = testsets.filter((item) => item.repositoryId === repositoryId && isTestsetEnabled(item))
  const loading = Boolean(repositoryId && branch) && gateQuery.isLoading
  const readOnly = !isAdmin

  return (
    <Drawer
      title="分支质量门禁"
      placement="right"
      size={560}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space wrap>
          <Select
            style={{ minWidth: 220 }}
            placeholder="选择仓库"
            value={repositoryId}
            onChange={handleRepoChange}
            options={repositories.map((repo) => ({ value: repo.id, label: repo.displayName || repo.fullName || repo.id }))}
          />
          <Select
            style={{ width: 220 }}
            placeholder={remoteBranchesQuery.isLoading ? '加载远程分支中…' : '选择目标分支'}
            value={branch}
            onChange={setBranch}
            loading={remoteBranchesQuery.isLoading}
            disabled={!repositoryId || remoteBranches.length === 0}
            options={remoteBranches.map((item) => ({
              value: item.name,
              label: `${item.name}${item.isProjectDefault ? '（项目默认）' : item.isGithubDefault ? '（GitHub 默认）' : ''}`,
            }))}
          />
        </Space>

        {!repositoryId ? (
          <Alert type="info" showIcon message="请先选择仓库" />
        ) : null}

        {remoteBranchesQuery.isError ? (
          <Alert type="error" showIcon message={formatApiError(remoteBranchesQuery.error)} />
        ) : null}

        {repositoryId && !remoteBranchesQuery.isLoading && remoteBranches.length === 0 ? (
          <Alert type="info" showIcon message="该仓库暂无 GitHub 远程分支，暂时无法配置分支质量门禁。" />
        ) : null}

        {!isAdmin ? (
          <Alert type="info" showIcon message="你以成员身份查看；仅 Project Admin 可编辑质量门禁。" />
        ) : null}

        {loading ? (
          <div className={styles.state} role="status">
            <Spin description="正在加载分支质量门禁" />
          </div>
        ) : null}

        {!loading && repositoryId && branch ? (
          <>
            <div>
              {gateQuery.isError ? (
                <Alert type="error" showIcon message={formatApiError(gateQuery.error)} />
              ) : (
                <Form<QualityGateUpdateInput>
                  form={gateForm}
                  layout="vertical"
                  disabled={readOnly}
                  initialValues={{ requiredTestsetIds: gateQuery.data?.requiredTestsetIds ?? [] }}
                  onFinish={(values) => void saveGate(values)}
                >
                  <div className={styles.columnTitle}>
                    <Text strong>MR 后必过检查（只读）</Text>
                  </div>
                  <Space wrap size={[4, 4]} style={{ marginBottom: 12 }}>
                    {(gateQuery.data?.requiredChecks ?? []).map((check) => (
                      <Tag key={check}>{check}</Tag>
                    ))}
                    {(gateQuery.data?.requiredChecks ?? []).length === 0 ? (
                      <Text type="secondary">无</Text>
                    ) : null}
                  </Space>

                  <Form.Item
                    name="requiredTestsetIds"
                    label="强制 Testset（该分支 Dry Run 必跑）"
                    extra="仅同一仓库、已启用的 Testset 可作为候选；普通成员不可绕过。"
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="选择强制 Testset"
                      options={enabledTestsets.map((item) => ({ value: item.id, label: item.name }))}
                    />
                  </Form.Item>
                  {isAdmin ? (
                    <Button type="primary" htmlType="submit" loading={updateGate.isPending}>
                      保存门禁
                    </Button>
                  ) : null}
                </Form>
              )}
            </div>
          </>
        ) : null}
      </Space>
    </Drawer>
  )
}
