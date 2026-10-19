import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { App } from 'antd'
import { useAuth } from '@/context/AuthContext'
import { authApi } from '@/api'
import { PATHS } from '@/routes/paths'
import { formatApiError } from '@/utils/formatApiError'
import './LoginPage.css'

type AuthTab = 'login' | 'register'

/**
 * 登录 / 注册页 —— 对齐接口文档 v1.1.3 §4
 * 左：品牌与价值主张；右：登录卡片
 */
export function LoginPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { login, register, completeAuth } = useAuth()
  const [tab, setTab] = useState<AuthTab>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [codeSending, setCodeSending] = useState(false)
  const [codeCountdown, setCodeCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const codeTimerRef = useRef<number | null>(null)

  // 卸载时清理验证码倒计时定时器
  useEffect(() => {
    return () => {
      if (codeTimerRef.current !== null) window.clearInterval(codeTimerRef.current)
    }
  }, [])

  /** 注册 tab：向邮箱发送验证码（60s 后可重发）。§11.1 发送前先做邮箱格式校验 */
  async function sendVerificationCode() {
    const trimmedEmail = email.trim()
    if (codeSending || codeCountdown > 0 || !trimmedEmail) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('请输入正确的邮箱地址')
      return
    }
    setError(null)
    setCodeSending(true)
    try {
      const result = await authApi.sendRegisterCode(trimmedEmail)
      // §11.1 响应 202：data.message 为「验证码已发送到邮箱，10 分钟内有效」
      message.success(result?.message || '验证码已发送到邮箱，10 分钟内有效')
      setCodeCountdown(60)
      if (codeTimerRef.current !== null) window.clearInterval(codeTimerRef.current)
      codeTimerRef.current = window.setInterval(() => {
        setCodeCountdown((prev) => {
          if (prev <= 1) {
            if (codeTimerRef.current !== null) window.clearInterval(codeTimerRef.current)
            codeTimerRef.current = null
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setCodeSending(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    // §11.2 注册必须携带 6 位数字邮箱验证码（「过了才能通过」）
    if (tab === 'register' && !/^\d{6}$/.test(verificationCode.trim())) {
      setError('请输入 6 位数字邮箱验证码')
      return
    }

    setSubmitting(true)

    try {
      const session =
        tab === 'login'
          ? await login(email, password)
          : await register(email, password, displayName || email.split('@')[0], verificationCode)
      // completeAuth 与 navigate 在同一同步块内，React 批处理成一次渲染，
      // 避免 setUser 先触发 RedirectIfAuthed 用残留的 location.state.from 抢跳
      completeAuth(session)
      navigate(session.hasTeam ? PATHS.MY_TEAMS : PATHS.WELCOME, { replace: true, state: null })
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  function switchTab(t: AuthTab) {
    setTab(t)
    setError(null)
  }

  return (
    <div className="login-page">
      {/* ===== 左侧品牌区（不变） ===== */}
      <aside className="login-page__brand" aria-label="品牌介绍">
        <div className="login-page__brand-logo">
          <span className="login-page__q">Q</span>
          <span>gents</span>
        </div>

        <h1 className="login-page__headline">
          团队与 Agent, 在同一个项目现场协作
        </h1>

        <ul className="login-page__features">
          <li>
            <span className="login-page__feature-icon" aria-hidden>
              <ChatIcon />
            </span>
            <div>
              <strong>项目群聊驱动任务</strong>
              <p>讨论在项目群，@Agent 发起任务，进度实时透明</p>
            </div>
          </li>
          <li>
            <span className="login-page__feature-icon" aria-hidden>
              <BotIcon />
            </span>
            <div>
              <strong>多 Agent 协同执行</strong>
              <p>多 Agent 协作分工，高效完成复杂任务</p>
            </div>
          </li>
          <li>
            <span className="login-page__feature-icon" aria-hidden>
              <CodeIcon />
            </span>
            <div>
              <strong>Diff 与 MR 可审查交付</strong>
              <p>以 Diff 形式交付，支持 MR 审查，变更可追溯</p>
            </div>
          </li>
        </ul>

        <div className="login-page__illustration" aria-hidden>
          <div className="login-page__illu-node">💬</div>
          <span className="login-page__illu-arrow" />
          <div className="login-page__illu-node login-page__illu-node--bot">🤖</div>
          <span className="login-page__illu-arrow" />
          <div className="login-page__illu-diff">
            <span>diff</span>
            <small>+12 −3</small>
          </div>
        </div>
      </aside>

      {/* ===== 右侧登录卡片 ===== */}
      <section className="login-page__panel">
        <div className="login-card">
          <header className="login-card__header">
            <h2>{tab === 'login' ? '登录 Qgents' : '注册 Qgents'}</h2>
            <p>
              {tab === 'login'
                ? '使用个人账号进入你的团队'
                : '创建账号，开始团队协作'}
            </p>
          </header>

          <div className="login-card__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'login'}
              className={tab === 'login' ? 'is-active' : ''}
              onClick={() => switchTab('login')}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'register'}
              className={tab === 'register' ? 'is-active' : ''}
              onClick={() => switchTab('register')}
            >
              注册
            </button>
          </div>

          {/* —— 错误提示 —— */}
          {error && (
            <div className="login-card__error" role="alert">
              {error}
            </div>
          )}

          <form className="login-card__form" onSubmit={handleSubmit}>
            {/* 邮箱 */}
            <label className="login-field">
              <span className="sr-only">邮箱地址</span>
              <span className="login-field__icon" aria-hidden>
                <MailIcon />
              </span>
              <input
                type="email"
                placeholder="邮箱地址"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {/* 昵称 —— 仅注册时显示 */}
            {tab === 'register' && (
              <label className="login-field">
                <span className="sr-only">昵称</span>
                <span className="login-field__icon" aria-hidden>
                  <UserIcon />
                </span>
                <input
                  type="text"
                  placeholder="你的昵称"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                />
              </label>
            )}

            {/* 邮箱验证码 —— 仅注册时显示：先获取验证码，填写后随注册提交 */}
            {tab === 'register' && (
              <div className="login-field login-field--code">
                <span className="sr-only">邮箱验证码</span>
                <span className="login-field__icon" aria-hidden>
                  <KeyIcon />
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="邮箱验证码"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  autoComplete="one-time-code"
                  required
                />
                <button
                  type="button"
                  className="login-field__code-btn"
                  onClick={() => void sendVerificationCode()}
                  disabled={codeSending || codeCountdown > 0 || !email.trim()}
                >
                  {codeCountdown > 0 ? `${codeCountdown}s` : codeSending ? '发送中…' : '获取验证码'}
                </button>
              </div>
            )}

            {/* 密码 */}
            <label className="login-field">
              <span className="sr-only">密码</span>
              <span className="login-field__icon" aria-hidden>
                <LockIcon />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                required
              />
              <button
                type="button"
                className="login-field__eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                <EyeIcon />
              </button>
            </label>

            {tab === 'login' && (
              <div className="login-card__meta">
                {/* 保持登录 checkbox 保存在 UI 里，但接口文档没有此字段 */}
                <label className="login-card__remember">
                  <input type="checkbox" defaultChecked />
                  保持登录
                </label>
                {/* 忘记密码：跳独立找回页（输入邮箱获取验证码 → 设置新密码） */}
                <Link to={PATHS.FORGOT_PASSWORD} className="login-card__link">
                  忘记密码
                </Link>
              </div>
            )}

            <button type="submit" className="login-card__submit" disabled={submitting}>
              {submitting
                ? '请稍候…'
                : tab === 'login'
                  ? '登录'
                  : '注册'}
            </button>
          </form>

          <p className="login-card__switch">
            {tab === 'login' ? (
              <>
                还没有账号？
                <button
                  type="button"
                  className="login-card__link"
                  onClick={() => switchTab('register')}
                >
                  立即注册
                </button>
              </>
            ) : (
              <>
                已有账号？
                <button
                  type="button"
                  className="login-card__link"
                  onClick={() => switchTab('login')}
                >
                  去登录
                </button>
              </>
            )}
          </p>

          <p className="login-card__footnote">登录后可选择或创建团队</p>
        </div>
      </section>
    </div>
  )
}
// ──── 图标组件（不变）────

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 4v-4.2A2.5 2.5 0 0 1 5 12.5v-6z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BotIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="8" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9.5" cy="13" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="13" r="1.2" fill="currentColor" />
      <path d="M12 4v4M8 19v2M16 19v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 7L4 12l5 5M15 7l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 20c1.2-3.5 3.8-5.5 7-5.5s5.8 2 7 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 10V7a4 4 0 0 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="8" cy="15" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 12l8-8M15 8l3 3M17 6l2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

