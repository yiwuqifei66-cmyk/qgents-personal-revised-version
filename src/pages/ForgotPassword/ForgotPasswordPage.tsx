import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { PATHS } from '@/routes/paths'
import { formatApiError } from '@/utils/formatApiError'
import { authApi } from '@/api'
import { RSA_KEY_ID, encryptPassword } from '@/utils/rsaConfig'
import './ForgotPasswordPage.css'

type Stage = 'request' | 'reset' | 'done'

/**
 * 忘记密码 —— 对齐接口文档 §4
 *
 * 第一步：输入邮箱 → POST /auth/password-reset-requests 发起找回密码邮件
 *          （后端邮件内含重置令牌/验证码）
 * 第二步：输入验证码（重置令牌）+ 新密码 → POST /auth/password-resets
 *          newPassword 使用平台 RSA 公钥加密后提交（§4.1）
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  // 取 useAuth 只是复用「已登录用户跳回」逻辑，未登录才是正常进入路径
  const { isAuthenticated } = useAuth()

  const [stage, setStage] = useState<Stage>('request')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const countdownTimerRef = useRef<number | null>(null)

  // 已登录用户直接回登录页，避免误进找回流程
  useEffect(() => {
    if (isAuthenticated) navigate(PATHS.LOGIN, { replace: true })
  }, [isAuthenticated, navigate])

  // 卸载时清理倒计时定时器
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current)
    }
  }, [])

  async function requestCode(): Promise<boolean> {
    setError(null)
    setSubmitting(true)
    try {
      await authApi.resetPasswordRequest(email.trim())
      setStage('reset')
      // 演示友好：发送成功后提供 60s 倒计时，可重发
      setCountdown(60)
      if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = window.setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current)
            countdownTimerRef.current = null
            return 0
          }
          return prev - 1
        })
      }, 1000)
      return true
    } catch (err) {
      setError(formatApiError(err))
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault()
    await requestCode()
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setSubmitting(true)
    try {
      // §4.1：newPassword 必须为 RSA 加密后的 Base64 密文
      const encryptedPassword = await encryptPassword(newPassword)
      await authApi.resetPassword({
        email: email.trim(),
        token: token.trim(),
        newPassword: encryptedPassword,
        passwordKeyId: RSA_KEY_ID,
      })
      setStage('done')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="forgot-page">
      <div className="forgot-page__panel">
        <div className="forgot-card">
          <header className="forgot-card__header">
            <div className="forgot-card__logo">
              <span className="forgot-card__q">Q</span>
              <span>gents</span>
            </div>
            <h2>
              {stage === 'request' && '找回密码'}
              {stage === 'reset' && '设置新密码'}
              {stage === 'done' && '密码已重置'}
            </h2>
            <p>
              {stage === 'request' && '输入注册邮箱，我们将发送验证码到你的邮箱'}
              {stage === 'reset' && `验证码已发送至 ${email}，请查收邮件`}
              {stage === 'done' && '新密码已生效，现在可以用新密码登录了'}
            </p>
          </header>

          {error && (
            <div className="forgot-card__error" role="alert">
              {error}
            </div>
          )}

          {stage === 'request' && (
            <form className="forgot-card__form" onSubmit={handleRequestCode}>
              <label className="forgot-field">
                <span className="forgot-field__icon" aria-hidden>
                  <MailIcon />
                </span>
                <input
                  type="email"
                  placeholder="注册邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <button type="submit" className="forgot-card__submit" disabled={submitting || !email.trim()}>
                {submitting ? '发送中…' : '获取验证码'}
              </button>
            </form>
          )}

          {stage === 'reset' && (
            <form className="forgot-card__form" onSubmit={handleReset}>
              <label className="forgot-field">
                <span className="forgot-field__icon" aria-hidden>
                  <KeyIcon />
                </span>
                <input
                  type="text"
                  placeholder="邮箱中的验证码 / 重置令牌"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </label>

              <label className="forgot-field">
                <span className="forgot-field__icon" aria-hidden>
                  <LockIcon />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="新密码"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="forgot-field__eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  <EyeIcon />
                </button>
              </label>

              <label className="forgot-field">
                <span className="forgot-field__icon" aria-hidden>
                  <LockIcon />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="确认新密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>

              <button type="submit" className="forgot-card__submit" disabled={submitting || !token.trim() || !newPassword || !confirmPassword}>
                {submitting ? '提交中…' : '重置密码'}
              </button>

              <div className="forgot-card__resend">
                {countdown > 0 ? (
                  <span>验证码已发送，{countdown}s 后可重新获取</span>
                ) : (
                  <button
                    type="button"
                    className="forgot-card__link"
                    disabled={submitting}
                    onClick={() => void requestCode()}
                  >
                    重新获取验证码
                  </button>
                )}
              </div>
            </form>
          )}

          {stage === 'done' && (
            <div className="forgot-card__done">
              <div className="forgot-card__done-icon" aria-hidden>
                <CheckIcon />
              </div>
              <Link className="forgot-card__submit forgot-card__submit--link" to={PATHS.LOGIN}>
                返回登录
              </Link>
            </div>
          )}

          <p className="forgot-card__footnote">
            想起来了？
            <Link className="forgot-card__link" to={PATHS.LOGIN}>
              返回登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

// ──── 图标组件（与登录页风格一致）────

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="8" y="10" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

function CheckIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
