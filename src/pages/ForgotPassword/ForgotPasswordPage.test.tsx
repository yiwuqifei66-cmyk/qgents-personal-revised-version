import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ForgotPasswordPage from './ForgotPasswordPage'

const authApiMock = vi.hoisted(() => ({
  resetPasswordRequest: vi.fn(),
  resetPassword: vi.fn(),
}))

vi.mock('@/api', () => ({
  authApi: authApiMock,
}))

// RSA 加密在 jsdom 下可用 jsencrypt（纯 JS），保持真实实现；若不稳定可整体替换
const encryptPasswordMock = vi.hoisted(() => vi.fn(async (plain: string) => `encrypted:${plain}`))

vi.mock('@/utils/rsaConfig', () => ({
  RSA_KEY_ID: 'rsa-2026-08',
  encryptPassword: encryptPasswordMock,
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPasswordPage />
    </MemoryRouter>,
  )
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authApiMock.resetPasswordRequest.mockResolvedValue(undefined)
    authApiMock.resetPassword.mockResolvedValue(undefined)
  })

  it('shows the request-code form first', () => {
    renderPage()
    expect(screen.getByText('找回密码')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('注册邮箱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeInTheDocument()
  })

  it('requests a reset code by email and advances to the reset stage', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('注册邮箱'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))

    await waitFor(() => {
      expect(authApiMock.resetPasswordRequest).toHaveBeenCalledWith('user@example.com')
      expect(screen.getByText(/验证码已发送至/)).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('邮箱中的验证码 / 重置令牌')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('新密码')).toBeInTheDocument()
  })

  it('rejects mismatched passwords before calling the API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('注册邮箱'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    await waitFor(() => expect(screen.getByPlaceholderText('新密码')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('邮箱中的验证码 / 重置令牌'), '123456')
    await user.type(screen.getByPlaceholderText('新密码'), 'password-1')
    await user.type(screen.getByPlaceholderText('确认新密码'), 'password-2')
    await user.click(screen.getByRole('button', { name: '重置密码' }))

    expect(authApiMock.resetPassword).not.toHaveBeenCalled()
    expect(screen.getByText('两次输入的新密码不一致')).toBeInTheDocument()
  })

  it('resets the password with RSA-encrypted newPassword', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('注册邮箱'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))
    await waitFor(() => expect(screen.getByPlaceholderText('新密码')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('邮箱中的验证码 / 重置令牌'), '123456')
    await user.type(screen.getByPlaceholderText('新密码'), 'password-1')
    await user.type(screen.getByPlaceholderText('确认新密码'), 'password-1')
    await user.click(screen.getByRole('button', { name: '重置密码' }))

    await waitFor(() => {
      expect(encryptPasswordMock).toHaveBeenCalledWith('password-1')
      expect(authApiMock.resetPassword).toHaveBeenCalledWith({
        email: 'user@example.com',
        token: '123456',
        newPassword: 'encrypted:password-1',
        passwordKeyId: 'rsa-2026-08',
      })
      expect(screen.getByText('密码已重置')).toBeInTheDocument()
    })
    expect(screen.getAllByRole('link', { name: '返回登录' }).length).toBeGreaterThan(0)
  })
})
