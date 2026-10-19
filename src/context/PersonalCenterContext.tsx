import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * 个人中心抽屉开关
 * 由 Banner 头像打开，侧栏关闭按钮 / 遮罩关闭
 */
interface PersonalCenterContextValue {
  open: boolean
  openPersonalCenter: () => void
  closePersonalCenter: () => void
  togglePersonalCenter: () => void
}

const PersonalCenterContext = createContext<PersonalCenterContextValue | null>(null)

export function PersonalCenterProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  const openPersonalCenter = useCallback(() => setOpen(true), [])
  const closePersonalCenter = useCallback(() => setOpen(false), [])
  const togglePersonalCenter = useCallback(() => setOpen((v) => !v), [])

  const value = useMemo(
    () => ({ open, openPersonalCenter, closePersonalCenter, togglePersonalCenter }),
    [open, openPersonalCenter, closePersonalCenter, togglePersonalCenter],
  )

  return (
    <PersonalCenterContext.Provider value={value}>{children}</PersonalCenterContext.Provider>
  )
}

export function usePersonalCenter() {
  const ctx = useContext(PersonalCenterContext)
  if (!ctx) {
    throw new Error('usePersonalCenter must be used within PersonalCenterProvider')
  }
  return ctx
}
