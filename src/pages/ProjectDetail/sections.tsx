import { useParams } from 'react-router-dom'
import { PROJECT_NAV } from '@/routes/paths'
import { MemoryPage as MemoryPageImpl } from './MemoryPage'
import { SkillPage as SkillPageImpl } from './SkillPage'
import { MembersPage as MembersPageImpl } from './MembersPage'
import { SettingsPage as SettingsPageImpl } from './Settings/SettingsPage'

export { OverviewPage } from './OverviewPage'

/**
 * 项目详情其它导航子页的统一占位壳
 * TODO: 各同学按模块拆成独立页面并实现业务
 */
export function ProjectSectionPage({
  section,
  title,
  todos,
}: {
  section: string
  title: string
  todos?: string[]
}) {
  const { projectId } = useParams<{ projectId: string }>()
  const nav = PROJECT_NAV.find((n) => n.path === section)

  return (
    <div className="pd-section">
      <header className="pd-section__header">
        <h1>{title || nav?.label || section}</h1>
        <p>
          projectId: <code>{projectId ?? '—'}</code>
        </p>
      </header>
      <div className="pd-section__body">
        <p className="pd-section__hint">页面框架占位，业务内容待填充。</p>
        {todos && todos.length > 0 ? (
          <ul className="pd-section__todo">
            {todos.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

/** 各子页薄封装 —— 方便路由表直接挂载 */
export function TasksPage() {
  return <ProjectSectionPage section="tasks" title="任务中心" todos={['TODO: B - 任务看板列与状态卡片']} />
}

export function AgentsPage() {
  return <ProjectSectionPage section="agents" title="Agent 团队" todos={['TODO: B - Agent 身份卡与团队管理']} />
}

export function SkillsPage() {
  return <SkillPageImpl />
}

export function MemoryPage() {
  return <MemoryPageImpl />
}

export { CodePage } from './CodePage'

export { TestsetPage } from './Testset/TestsetPage'

export function MembersPage() {
  return <MembersPageImpl />
}

export function SettingsPage() {
  return <SettingsPageImpl />
}
