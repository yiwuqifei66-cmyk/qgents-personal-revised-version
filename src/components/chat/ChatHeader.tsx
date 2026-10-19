import { Avatar, Button, Space, Typography } from 'antd'
import { SettingOutlined, TeamOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { Group } from '@/types'
import type { Project } from '@/types/project'
import './ChatPanel.css'

const { Text } = Typography

export function ChatHeader({ group, project, canOpenTaskTrigger, onOpenTaskTrigger, onOpenSettings }: {
  group?: Group
  project?: Project
  canOpenTaskTrigger: boolean
  onOpenTaskTrigger: () => void
  onOpenSettings: () => void
}) {
  return <div className="chat-panel__header">
    <div className="chat-panel__header-title">
      {group?.type === 'PROJECT_MAIN' ? <Avatar size={36} src={project?.avatarUrl} icon={<TeamOutlined />} style={{ background: '#3b82f6', flexShrink: 0 }} /> : null}
      <div style={{ minWidth: 0 }}><Text strong style={{ fontSize: 16 }}><Text type="success">#</Text> {group?.title ?? '群聊'}</Text><div><Text type="secondary" style={{ fontSize: 12 }}>{group?.type === 'PROJECT_MAIN' ? '项目总群' : '需求群'}{group?.memberCount ? ` · ${group.memberCount} 人` : ''}</Text></div></div>
    </div>
    <Space className="chat-panel__header-actions" size={8} wrap>
      {canOpenTaskTrigger ? <Button type="primary" ghost icon={<ThunderboltOutlined />} onClick={onOpenTaskTrigger}>发起任务</Button> : null}
      <Button icon={<SettingOutlined />} onClick={onOpenSettings}>群聊设置</Button>
    </Space>
  </div>
}
