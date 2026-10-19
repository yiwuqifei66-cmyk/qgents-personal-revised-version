import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Card, Collapse, Empty, Spin, Tag, Typography } from 'antd'
import { CaretRightOutlined, FileTextOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { useWorkspaceDiffPreview, useWorkspaceDiffPreviewFilePatch, useWorkspaceDiffPreviewFiles } from '@/hooks/workspaceDiffPreview'
import type { WorkspaceDiffPreviewFile, WorkspaceDiffPreviewStatus } from '@/types/task-model'
import styles from './TaskDetailPage.module.scss'
import { highlightDiffCode, syntaxLanguageLabel } from '@/utils/diffSyntaxHighlight'

const { Text } = Typography

interface WorkspaceDiffPreviewCardProps {
  projectId: string
  taskId: string
  repositories: ReadonlyArray<{ repositoryId: string; name: string }>
}

/**
 * Workspace 实时 Diff Preview 卡片。
 *
 * 语义边界：
 * - 仅展示 Coding 写入触发的累计工作树视图，不代表已生成正式 Diff。
 * - 失败/不可用时显示「实时预览暂不可用」，不污染任务状态。
 * - /files 仅作为文件导航；用户选中文件后通过 §48 /file 读取该文件 patch。
 */
export function WorkspaceDiffPreviewCard({ projectId, taskId, repositories }: WorkspaceDiffPreviewCardProps) {
  const previewQuery = useWorkspaceDiffPreview(projectId, taskId)
  const status = previewQuery.data
  const availablePreview = status?.kind === 'available' ? status.preview : null
  // 文件导航与详情锁定在同一个实际 revision，避免 Preview 更新时混用两个 snapshot。
  const filesQuery = useWorkspaceDiffPreviewFiles(projectId, taskId, { revision: availablePreview?.revision })

  const summary = useMemo(() => buildSummary(status, previewQuery.isLoading, filesQuery.isLoading, filesQuery.data?.length ?? 0), [
    status,
    previewQuery.isLoading,
    filesQuery.isLoading,
    filesQuery.data,
  ])
  const repositoryNames = useMemo(() => Object.fromEntries(repositories.map((repository) => [repository.repositoryId, repository.name])), [repositories])
  // 旧 /files 响应只保证 repositoryPath。单仓库 Task 的所属仓库唯一，可安全补齐；
  // 多仓库场景仍必须由服务端返回 repositoryId，不能按目录名或数组位置猜测。
  const files = useMemo(() => resolveFileRepositoryIds(filesQuery.data ?? [], repositories), [filesQuery.data, repositories])
  const filesByRepository = useMemo(() => groupFilesByRepository(files, repositoryNames), [files, repositoryNames])

  // 默认折叠；SSE 刷新不强制打开。revision 更新时清除选择，避免旧 snapshot 覆盖当前展示。
  const [expanded, setExpanded] = useState(false)
  const [selectedFile, setSelectedFile] = useState<WorkspaceDiffPreviewFile | null>(null)
  const selectedPatchQuery = useWorkspaceDiffPreviewFilePatch(projectId, taskId, {
    repositoryId: selectedFile?.repositoryId ?? '',
    path: selectedFile?.path ?? '',
    revision: availablePreview?.revision,
    enabled: expanded && selectedFile !== null,
  })

  useEffect(() => {
    setSelectedFile(null)
  }, [availablePreview?.revision])

  // 打开 Preview 时默认定位第一个可读取的文件；用户仍可随时切换文件。
  useEffect(() => {
    if (!expanded || selectedFile) return
    const firstSelectableFile = files.find((file) => file.repositoryId)
    if (firstSelectableFile) setSelectedFile(firstSelectableFile)
  }, [expanded, files, selectedFile])

  return (
    <Card className={styles.workspaceDiffPreviewCard} size="small" data-testid="workspace-diff-preview-card">
      <div className={styles.cardHeading}>
        <span><FileTextOutlined />实时预览</span>
        <Text type="secondary" data-testid="workspace-diff-preview-summary">{summary.headline}</Text>
      </div>
      {summary.kind === 'loading' ? (
        <PreviewLoadingState />
      ) : summary.kind === 'empty' ? (
        <Text type="secondary" className={styles.compactEmpty}>Coding 尚未产生可预览的工作树变更</Text>
      ) : summary.kind === 'unavailable' ? (
        <Alert
          type="info"
          showIcon
          className={styles.workspaceDiffPreviewAlert}
          message="实时预览暂不可用"
          description={summary.message ?? null}
        />
      ) : summary.kind === 'available' ? (
        <>
          <Collapse
            ghost
            className={styles.workspaceDiffPreviewCollapse}
            activeKey={expanded ? ['preview'] : []}
            onChange={(keys) => setExpanded(Array.isArray(keys) ? keys.includes('preview') : keys === 'preview')}
            items={[{
              key: 'preview',
              label: expanded ? '收起实时 Diff' : '查看实时 Diff',
              children: (<>
                {filesQuery.isLoading ? (
                  <div className={styles.inlineState}><Spin size="small" /><Text type="secondary">正在加载文件列表</Text></div>
                ) : filesByRepository.length === 0 ? (
                  <Empty description="暂无文件" />
                ) : (
                  <div className={styles.workspaceDiffPreviewViewer}>
                    <aside className={styles.workspaceDiffPreviewFiles} aria-label="实时预览文件树">
                      <Text className={styles.workspaceDiffPreviewFilesHeading}><FolderOpenOutlined />文件树</Text>
                      {filesByRepository.map(({ repositoryKey, repositoryName, files }) => (
                        <div key={repositoryKey} className={styles.workspaceDiffPreviewRepo}>
                          <div className={styles.workspaceDiffPreviewRepoHeading}>
                            <Text strong className={styles.workspaceDiffPreviewRepoName}>{repositoryName}</Text>
                            <Text type="secondary">{files.length}</Text>
                          </div>
                          <ul className={styles.workspaceDiffPreviewFileList}>
                            {files.map((file) => (
                              <li key={`${repositoryKey}:${file.path}`}>
                                <button
                                  type="button"
                                  className={`${styles.workspaceDiffPreviewFileItem}${selectedFile?.repositoryId === file.repositoryId && selectedFile.path === file.path ? ` ${styles.workspaceDiffPreviewFileItemSelected}` : ''}`}
                                  onClick={() => setSelectedFile(file)}
                                  disabled={!file.repositoryId}
                                  title={file.repositoryId ? file.path : '当前文件列表未返回 repositoryId，无法安全读取单文件预览'}
                                >
                                  <Tag color={file.changeType === 'ADDED' ? 'green' : file.changeType === 'DELETED' ? 'red' : file.changeType === 'RENAMED' ? 'blue' : 'orange'}>{file.changeType}</Tag>
                                  <span className={styles.workspaceDiffPreviewPath}>{file.path}</span>
                                  <Text type="secondary" className={styles.workspaceDiffPreviewStats}>+{file.additions} / -{file.deletions}{file.binary ? ' · binary' : ''}</Text>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </aside>
                    <section className={styles.workspaceDiffPreviewContent} aria-live="polite">
                      <SelectedFilePatch file={selectedFile} query={selectedPatchQuery} />
                    </section>
                  </div>
                )}
              </>),
              extra: <CaretRightOutlined rotate={expanded ? 90 : 0} aria-hidden />,
            }]}
          />
        </>
      ) : null}
    </Card>
  )
}

function PreviewLoadingState() {
  return <div className={styles.previewLoadingState} role="status">
    <div className={styles.previewLoadingLines} aria-hidden>
      <span />
      <span />
      <span />
    </div>
    <Text type="secondary">正在汇集工作区变更</Text>
  </div>
}

interface Summary {
  kind: 'loading' | 'empty' | 'unavailable' | 'available'
  headline: string
  message?: string
}

function buildSummary(
  status: WorkspaceDiffPreviewStatus | undefined,
  previewLoading: boolean,
  filesLoading: boolean,
  filesCount: number,
): Summary {
  if (previewLoading) {
    return { kind: 'loading', headline: '正在加载实时预览' }
  }
  if (!status) {
    return { kind: 'loading', headline: '正在加载实时预览' }
  }
  if (status.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      headline: '实时预览暂不可用',
      message: unavailableMessage(status.reason, status.message),
    }
  }
  const preview = status.preview
  if (preview.filesChanged === 0 && filesCount === 0 && !filesLoading) {
    return { kind: 'empty', headline: 'Coding 尚未产生可预览的工作树变更' }
  }
  return {
    kind: 'available',
    headline: `实时预览：${preview.filesChanged} 个文件 · +${preview.additions} / -${preview.deletions} · revision ${preview.revision}`,
  }
}

function unavailableMessage(reason: 'NOT_FOUND' | 'WORKER_UNAVAILABLE' | 'UNKNOWN', fallback: string): string {
  if (reason === 'WORKER_UNAVAILABLE') return 'Worker 暂不可用，实时预览暂不可用；任务执行不受影响。'
  if (reason === 'NOT_FOUND') return 'Coding 尚未触发写入，实时预览待生成。'
  return fallback
}

interface RepositoryGroup {
  repositoryKey: string
  repositoryName: string
  files: WorkspaceDiffPreviewFile[]
}

function SelectedFilePatch({ file, query }: { file: WorkspaceDiffPreviewFile | null; query: ReturnType<typeof useWorkspaceDiffPreviewFilePatch> }) {
  if (!file) return <div className={styles.workspaceDiffPreviewEmptySelection}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个文件以查看实时 Diff" /></div>
  const fileLabel = file.repositoryPath ? `${file.repositoryPath}/${file.path}` : file.path
  const content = !file.repositoryId ? (
    <Alert type="info" showIcon message="该文件暂不能读取实时预览" description="文件列表未返回 repositoryId，前端不会猜测仓库归属。" />
  ) : query.isLoading || query.isError ? (
    <div className={styles.workspaceDiffPreviewLoadingFile} role="status" aria-label="正在加载文件 Diff"><Spin size="small" /></div>
  ) : null

  if (content) return <SelectedFilePanel file={file} fileLabel={fileLabel}>{content}</SelectedFilePanel>
  const patch = query.data
  return (
    <SelectedFilePanel file={file} fileLabel={fileLabel}>
      {!patch || patch.patch === null
        ? <Alert type="info" showIcon message={patch?.binary ? '二进制文件，不展示源码 Diff' : '该文件的实时预览暂不可用'} />
        : <PatchPreview patch={patch.patch} path={file.path} />}
    </SelectedFilePanel>
  )
}

function SelectedFilePanel({ file, fileLabel, children }: { file: WorkspaceDiffPreviewFile; fileLabel: string; children: ReactNode }) {
  return (
    <div className={styles.workspaceDiffPreviewSelectedFile}>
      <div className={styles.workspaceDiffPreviewSelectedFileHeading}>
        <Text className={styles.workspaceDiffPreviewSelectedFileName} title={fileLabel}>{fileLabel}</Text>
        <Tag>{syntaxLanguageLabel(file.path)}</Tag>
        <span className={styles.workspaceDiffPreviewSelectedFileStats}>
          <span className={styles.workspaceDiffPreviewSelectedFileAdditions}>+{file.additions}</span>
          <span className={styles.workspaceDiffPreviewSelectedFileDeletions}>-{file.deletions}</span>
        </span>
      </div>
      {children}
    </div>
  )
}

function groupFilesByRepository(files: WorkspaceDiffPreviewFile[], names: Record<string, string>): RepositoryGroup[] {
  const map = new Map<string, RepositoryGroup>()
  for (const file of files) {
    const repositoryKey = file.repositoryPath
      ? `path:${file.repositoryPath}`
      : file.repositoryId
        ? `id:${file.repositoryId}`
        : 'workspace-root'
    const existing = map.get(repositoryKey)
    if (existing) {
      existing.files.push(file)
      continue
    }
    map.set(repositoryKey, {
      repositoryKey,
      repositoryName: file.repositoryPath ?? (file.repositoryId ? names[file.repositoryId] ?? file.repositoryId : '当前工作区'),
      files: [file],
    })
  }
  return [...map.values()].sort((left, right) => left.repositoryName.localeCompare(right.repositoryName))
}

function resolveFileRepositoryIds(
  files: WorkspaceDiffPreviewFile[],
  repositories: ReadonlyArray<{ repositoryId: string }>,
): WorkspaceDiffPreviewFile[] {
  if (repositories.length !== 1) return files
  const repositoryId = repositories[0]?.repositoryId
  if (!repositoryId) return files
  return files.map((file) => file.repositoryId ? file : { ...file, repositoryId })
}

function PatchPreview({ patch, path }: { patch: string; path: string }) {
  const lines = parsePatchLines(patch)
  return (
    <div className={styles.workspaceDiffPreviewPatch} data-testid="workspace-diff-preview-patch" role="table" aria-label="实时 Diff">
      {lines.map((line, index) => (
        <div
          key={`${index}:${line.kind}:${line.content}`}
          className={`${styles.workspaceDiffPreviewPatchRow} ${styles[line.kind]}`}
          data-testid={`workspace-diff-line-${line.kind}`}
          role="row"
        >
          <span className={styles.workspaceDiffPreviewPatchLineNumber} data-testid="workspace-diff-old-line-number" role="cell">{line.oldLineNumber ?? ''}</span>
          <span className={styles.workspaceDiffPreviewPatchLineNumber} data-testid="workspace-diff-new-line-number" role="cell">{line.newLineNumber ?? ''}</span>
          <span className={styles.workspaceDiffPreviewPatchMarker} aria-hidden role="cell">{line.marker}</span>
          <span className={styles.workspaceDiffPreviewPatchCode} role="cell">{highlightDiffCode(line.content || ' ', path)}</span>
        </div>
      ))}
    </div>
  )
}

type PatchLineKind = 'workspaceDiffPreviewPatchAdded' | 'workspaceDiffPreviewPatchDeleted' | 'workspaceDiffPreviewPatchContext'

interface PatchLine {
  kind: PatchLineKind
  marker: '+' | '-' | ' '
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

function parsePatchLines(patch: string): PatchLine[] {
  const lines: PatchLine[] = []
  let oldLineNumber: number | null = null
  let newLineNumber: number | null = null

  for (const rawLine of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine)
    if (hunk) {
      oldLineNumber = Number(hunk[1])
      newLineNumber = Number(hunk[2])
      continue
    }
    if (isPatchMetadata(rawLine)) continue

    if (rawLine.startsWith('+')) {
      lines.push({ kind: 'workspaceDiffPreviewPatchAdded', marker: '+', content: rawLine.slice(1), oldLineNumber: null, newLineNumber })
      newLineNumber = incrementLineNumber(newLineNumber)
    } else if (rawLine.startsWith('-')) {
      lines.push({ kind: 'workspaceDiffPreviewPatchDeleted', marker: '-', content: rawLine.slice(1), oldLineNumber, newLineNumber: null })
      oldLineNumber = incrementLineNumber(oldLineNumber)
    } else {
      const content = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine
      lines.push({ kind: 'workspaceDiffPreviewPatchContext', marker: ' ', content, oldLineNumber, newLineNumber })
      oldLineNumber = incrementLineNumber(oldLineNumber)
      newLineNumber = incrementLineNumber(newLineNumber)
    }
  }
  return lines
}

function isPatchMetadata(line: string): boolean {
  return line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')
    || line.startsWith('new file mode ') || line.startsWith('deleted file mode ') || line.startsWith('similarity index ')
    || line.startsWith('rename from ') || line.startsWith('rename to ') || line === '\\ No newline at end of file'
}

function incrementLineNumber(value: number | null): number | null {
  return value === null ? null : value + 1
}
