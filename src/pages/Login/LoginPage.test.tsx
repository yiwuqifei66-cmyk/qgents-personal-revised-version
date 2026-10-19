import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const authApiMock = vi.hoisted(() => ({
  sendRegisterCode: vi.fn(),
}))
vi.mock('@/api', () => ({ authApi: authApiMock }))

const registerMock = vi.hoisted(() => vi.fn())
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    hasTeam: false,
    isBootstrapping: false,
    login: vi.fn(),
    register: registerMock,
    completeAuth: vi.fn(),
    logout: vi.fn(),
    setHasTeam: vi.fn(),
    updateUser: vi.fn(),
  }),
}))

// RSA 加密保持真实实现（jsencrypt 纯 JS 可用）；这里只验证验证码流程，不验证加密
vi.mock('@/utils/rsaConfig', () => ({
  RSA_KEY_ID: 'rsa-2026-08',
  encryptPassword: vi.fn(async (plain: string) => `encrypted:${plain}`),
}))

function renderPage() {
  return render(
    <App>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </App>,
  )
}

async function switchToRegister(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: '注册' }))
}

describe('LoginPage 注册验证码', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authApiMock.sendRegisterCode.mockResolvedValue({ message: '验证码已发送到邮箱，10 分钟内有效' })
    registerMock.mockResolvedValue({ user: { id: 'u1', email: 'u@example.com', displayName: 'U' }, hasTeam: false })
  })

  it('shows the verification-code field and button only on the register tab', async () => {
    const user = userEvent.setup()
    renderPage()

    // 登录 tab：无验证码字段
    expect(screen.queryByPlaceholderText('邮箱验证码')).not.toBeInTheDocument()

    await switchToRegister(user)
    expect(screen.getByPlaceholderText('邮箱验证码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeInTheDocument()
  })

  it('sends a verification code to the email and starts the countdown', async () => {
    const user = userEvent.setup()
    renderPage()
    await switchToRegister(user)

    await user.type(screen.getByPlaceholderText('邮箱地址'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))

    await waitFor(() => {
      expect(authApiMock.sendRegisterCode).toHaveBeenCalledWith('new@example.com')
    })
    // 倒计时出现（60s 内按钮变为秒数）
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^\d+s$/ })).toBeInTheDocument()
    })
  })

  it('blocks sending a code with an invalid email format', async () => {
    const user = userEvent.setup()
    renderPage()
    await switchToRegister(user)

    await user.type(screen.getByPlaceholderText('邮箱地址'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: '获取验证码' }))

    expect(authApiMock.sendRegisterCode).not.toHaveBeenCalled()
    expect(screen.getByText('请输入正确的邮箱地址')).toBeInTheDocument()
  })

  it('blocks registration without a 6-digit verification code', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await switchToRegister(user)

    await user.type(screen.getByPlaceholderText('邮箱地址'), 'new@example.com')
    await user.type(screen.getByPlaceholderText('你的昵称'), '新用户')
    await user.type(screen.getByPlaceholderText('密码'), 'password-1')

    // 验证码未填/非 6 位数字时提交被前端显式校验拦截（fireEvent.submit 绕过 HTML5 required，
    // 直接触发 onSubmit 验证 handleSubmit 内的拦截逻辑），register 不会被调用
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(registerMock).not.toHaveBeenCalled()
    expect(screen.getByText('请输入 6 位数字邮箱验证码')).toBeInTheDocument()

    // 填了非 6 位数字同样拦截
    await user.type(screen.getByPlaceholderText('邮箱验证码'), '12345')
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('passes the verification code when registering', async () => {
    const user = userEvent.setup()
    renderPage()
    await switchToRegister(user)

    await user.type(screen.getByPlaceholderText('邮箱地址'), 'new@example.com')
    await user.type(screen.getByPlaceholderText('你的昵称'), '新用户')
    await user.type(screen.getByPlaceholderText('密码'), 'password-1')
    await user.type(screen.getByPlaceholderText('邮箱验证码'), '483920')
    await user.click(screen.getByRole('button', { name: '注册' }))

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith('new@example.com', 'password-1', '新用户', '483920')
    })
  })
})
