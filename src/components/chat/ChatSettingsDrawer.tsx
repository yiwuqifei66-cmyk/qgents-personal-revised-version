import { Button, Divider, Drawer, Popconfirm, Space } from 'antd'
import { InboxOutlined, MessageOutlined } from '@ant-design/icons'
import { GroupMemberSettings } from '@/pages/ProjectDetail/GroupMemberSettings'
import type { Group } from '@/types'

export function ChatSettingsDrawer({
  open,
  projectId,
  group,
  canArchive,
  memoryLoading,
  archiveLoading,
  onClose,
  onCreateMemory,
  onArchive,
}: {
  open: boolean
  projectId: string
  group: Group | null
  canArchive: boolean
  memoryLoading: boolean
  archiveLoading: boolean
  onClose: () => void
  onCreateMemory: () => void
  onArchive: () => void
}) {
  return <Drawer title="群聊设置" placement="right" width={320} open={open} onClose={onClose}>
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <GroupMemberSettings projectId={projectId} group={group} />
      <Divider />
      <Button block icon={<MessageOutlined />} loading={memoryLoading} onClick={onCreateMemory}>AI 沉淀 Memory</Button>
      {canArchive ? <Popconfirm title="归档需求群" description="归档后该群将移入「已归档」，不可恢复。确定归档？" okText="归档" cancelText="取消" onConfirm={onArchive}>
        <Button block danger icon={<InboxOutlined />} loading={archiveLoading}>归档需求群</Button>
      </Popconfirm> : null}
    </Space>
  </Drawer>
}
