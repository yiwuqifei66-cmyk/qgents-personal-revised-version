import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@/types'
import { authApi, teamApi } from '@/api'
import { AUTH_EXPIRED_EVENT } from '@/api/client'
import { RSA_KEY_ID, encryptPassword } from '@/utils/rsaConfig'

interface AuthContextValue {
  /** 当前用户，null = 未登录 */
  user: User | null
  /** 是否已登录 */
  isAuthenticated: boolean
  /** 是否已加入至少一个团队 */
  hasTeam: boolean
  /** 是否正在初始化（bootstrap 阶段） */
  isBootstrapping: boolean

  /** 登录：只调接口 + 存 token，返回会话，不更新 state */
  login: (email: string, password: string) => Promise<AuthSession>
  /** 注册：只调接口 + 存 token，返回会话，不更新 state；verificationCode 为邮箱验证码 */
  register: (email: string, password: string, displayName: string, verificationCode: string) => Promise<AuthSession>
  /** 把登录/注册结果一次性写入 state（与 navigate 同批调用，避免 RedirectIfAuthed 抢跳） */
  completeAuth: (session: AuthSession) => void
  /** 退出登录 */
  logout: () => Promise<void>
  /** 设置 hasTeam（创建/加入团队后调用） */
  setHasTeam: (v: boolean) => void
  /** 更新当前用户资料（PATCH /me 成功后同步本地 user，如昵称/头像） */
  updateUser: (user: User) => void
}

/** 登录/注册成功后的会话结果 */
export interface AuthSession {
  user: User
  hasTeam: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** localStorage key */
const ACCESS_TOKEN_KEY = 'qgents_access_token'
const REFRESH_TOKEN_KEY = 'qgents_refresh_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [hasTeam, setHasTeam] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  // ──── 启动时恢复登录态 ────
  // 每次挂载都执行 restore；用 cancelled 标志处理卸载竞态。
  // React StrictMode 开发模式下会「挂载 → 卸载 → 再挂载」，
  // 第一次 restore 因 cleanup 置 cancelled 而被丢弃，第二次挂载重新恢复。
  useEffect(() => {
    let cancelled = false
    // StrictMode 下组件会「挂载 → 卸载 → 再挂载」，cleanup 里 abort 掉首挂载发出的 /me，
    // 避免同一次刷新真实发出两个 /me（第二个还会在连接上排队 stall）。
    const controller = new AbortController()

    async function restore() {
      const token = localStorage.getItem(ACCESS_TOKEN_KEY)
      if (!token) {
        if (!cancelled) setIsBootstrapping(false)
        return
      }

      try {
        const me = await authApi.me(controller.signal)
        if (cancelled) return
        const user = me.user
        if (!user?.id) throw new Error('GET /me 未返回用户')
        setUser(user)
        // /me 已返回 teams 聚合，直接取用；为空时兜底再查一次
        if (me.teams && me.teams.length > 0) {
          setHasTeam(true)
        } else {
          const teams = await teamApi.listMine()
          if (cancelled) return
          setHasTeam(teams.length > 0)
        }
      } catch {
        // token 过期或无效 → 清掉
        if (!cancelled) {
          localStorage.removeItem(ACCESS_TOKEN_KEY)
          localStorage.removeItem(REFRESH_TOKEN_KEY)
        }
      } finally {
        if (!cancelled) setIsBootstrapping(false)
      }
    }

    restore()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  // ──── 监听登录态失效（client.ts 在 refresh 也失败时派发）────
  // user 置 null 后，RequireAuth 守卫会自动跳回登录页
  useEffect(() => {
    function handleAuthExpired() {
      setUser(null)
      setHasTeam(false)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [])

  // ──── 登录：只调接口 + 存 token，返回会话；state 由 completeAuth 统一写入 ────
  const login = useCallback(async (email: string, password: string): Promise<AuthSession> => {
    // 使用硬编码的固定 RSA 公钥加密密码（mock 阶段 encryptPassword 直传明文）
    const encryptedPassword = await encryptPassword(password)

    const result = await authApi.login({
      email,
      password: encryptedPassword,
      passwordKeyId: RSA_KEY_ID,
    })

    if (!result.accessToken || !result.refreshToken || !result.user) {
      throw new Error('登录响应缺少 token 或用户信息')
    }

    localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken)
    localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken)

    // 查清团队归属（这里不 setState，避免在 LoginPage 的 navigate 之前先触发一次
    // 渲染，让 RedirectIfAuthed 用残留的 location.state.from 抢跳）
    let haveTeam = false
    try {
      const teams = await teamApi.listMine()
      haveTeam = teams.length > 0
    } catch {
      haveTeam = false
    }

    return { user: result.user, hasTeam: haveTeam }
  }, [])

  // ──── 注册：只调接口 + 存 token，返回会话（新用户没有团队）────
  const register = useCallback(
    async (email: string, password: string, displayName: string, verificationCode: string): Promise<AuthSession> => {
      // 使用硬编码的固定 RSA 公钥加密密码（mock 阶段 encryptPassword 直传明文）
      const encryptedPassword = await encryptPassword(password)

      const result = await authApi.register({
        email,
        password: encryptedPassword,
        passwordKeyId: RSA_KEY_ID,
        displayName,
        verificationCode,
      })

      localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken)
      localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken)
      return { user: result.user, hasTeam: false }
    },
    [],
  )

  // ──── 退出 ────
  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY) ?? undefined
    try {
      await authApi.logout(refreshToken)
    } catch {
      // 即使接口失败也要清除本地状态
    }
    setUser(null)
    setHasTeam(false)
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  }, [])

  // ──── 把登录/注册结果一次性写入 state，供 LoginPage 在 navigate 的同一同步块内调用 ────
  const completeAuth = useCallback((session: AuthSession) => {
    setUser(session.user)
    setHasTeam(session.hasTeam)
  }, [])

  // ──── 更新当前用户资料（PATCH /me 成功后同步本地 user）────
  const updateUser = useCallback((next: User) => {
    setUser(next)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      hasTeam,
      isBootstrapping,
      login,
      register,
      completeAuth,
      logout,
      setHasTeam,
      updateUser,
    }),
    [user, hasTeam, isBootstrapping, login, register, completeAuth, logout, updateUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
