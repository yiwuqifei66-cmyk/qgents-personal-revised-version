import { create } from 'zustand'
import type { TeamRole } from '@/types'

const PROJECT_DETAIL_NAV_KEY = 'qgents_banner_project_detail'

function readStoredProjectDetailNav(): { projectId: string } | null {
  try {
    const raw = sessionStorage.getItem(PROJECT_DETAIL_NAV_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { projectId?: string }
    if (!parsed.projectId) return null
    return { projectId: parsed.projectId }
  } catch {
    return null
  }
}

interface AppUiStore {
  // ──── UI 开关 ────
  sidebarCollapsed: boolean
  taskPanelOpen: boolean
  /**
   * Banner「项目详情」页签：仅在点击「进入项目详情」后出现；
   * 离开项目区（点团队首页 / 项目群聊）时清除。
   */
  projectDetailNav: { projectId: string } | null
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setTaskPanelOpen: (open: boolean) => void
  toggleTaskPanel: () => void
  openProjectDetailNav: (projectId: string) => void
  clearProjectDetailNav: () => void

  // ──── 全局上下文 ────
  /** 当前所在团队 ID，null = 尚未进入任何团队 */
  currentTeamId: string | null
  /** 当前所在团队角色（用于 Banner「团队首页」跳转时带 as=owner），null = 未知 */
  currentTeamRole: TeamRole | null
  /** 当前所在项目 ID，null = 尚未进入任何项目 */
  currentProjectId: string | null
  setCurrentTeam: (teamId: string, role?: TeamRole) => void
  setCurrentProject: (projectId: string) => void
  /** 退出登录或切换团队时清空 */
  clearContext: () => void
}

export const useAppUiStore = create<AppUiStore>((set) => ({
  // ──── UI 开关 ────
  sidebarCollapsed: false,
  taskPanelOpen: false,
  projectDetailNav: readStoredProjectDetailNav(),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setTaskPanelOpen: (taskPanelOpen) => set({ taskPanelOpen }),
  toggleTaskPanel: () => set((state) => ({ taskPanelOpen: !state.taskPanelOpen })),
  openProjectDetailNav: (projectId) => {
    const next = { projectId }
    sessionStorage.setItem(PROJECT_DETAIL_NAV_KEY, JSON.stringify(next))
    set({ projectDetailNav: next })
  },
  clearProjectDetailNav: () => {
    sessionStorage.removeItem(PROJECT_DETAIL_NAV_KEY)
    set({ projectDetailNav: null })
  },

  // ──── 全局上下文 ────
  currentTeamId: null,
  currentTeamRole: null,
  currentProjectId: null,
  setCurrentTeam: (teamId, role) =>
    set({ currentTeamId: teamId, currentTeamRole: role ?? null, currentProjectId: null }),
  setCurrentProject: (projectId) => set({ currentProjectId: projectId }),
  clearContext: () => set({ currentTeamId: null, currentProjectId: null }),
}))

export const useSidebarCollapsed = () => useAppUiStore((state) => state.sidebarCollapsed)
export const useTaskPanelOpen = () => useAppUiStore((state) => state.taskPanelOpen)
export const useProjectDetailNav = () => useAppUiStore((state) => state.projectDetailNav)
export const useCurrentTeamId = () => useAppUiStore((state) => state.currentTeamId)
export const useCurrentTeamRole = () => useAppUiStore((state) => state.currentTeamRole)
export const useCurrentProjectId = () => useAppUiStore((state) => state.currentProjectId)
