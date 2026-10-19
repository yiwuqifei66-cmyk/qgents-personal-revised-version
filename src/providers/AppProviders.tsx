import { App as AntdApp, ConfigProvider, Spin } from 'antd'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { PersonalCenterProvider } from '@/context/PersonalCenterContext'
import { queryClient } from '@/query'
import { QG_FONT_FAMILY } from '@/theme/antdTheme'

/**
 * 启动加载门控。
 * AuthProvider 内部自动完成 token 恢复，这里只读 isBootstrapping 决定展示 loading 还是 children。
 */
function BootstrapGate({ children }: { children: ReactNode }) {
  const { isBootstrapping } = useAuth()

  if (isBootstrapping) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: '#0f172a',
        }}
      >
        <Spin size="large" />
      </div>
    )
  }

  return <>{children}</>
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{ token: { colorPrimary: '#0d9b8a', borderRadius: 10, fontFamily: QG_FONT_FAMILY } }}
      modal={{ centered: true }}
    >
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <PersonalCenterProvider>
              <BootstrapGate>{children}</BootstrapGate>
            </PersonalCenterProvider>
          </AuthProvider>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  )
}
