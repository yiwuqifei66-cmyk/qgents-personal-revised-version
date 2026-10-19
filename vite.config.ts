import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin, ViteDevServer } from 'vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

type MswHandler = {
  run: (args: {
    request: Request
    requestId: string
    resolutionContext?: { baseUrl?: string }
  }) => Promise<{ response?: Response } | null>
}

function isMswHandler(value: unknown): value is MswHandler {
  return typeof value === 'object' && value !== null && 'run' in value && typeof value.run === 'function'
}

function jsonError(res: ServerResponse, status: number, code: string, message: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: { code, message } }))
}

async function respondWithMsw(
  server: ViteDevServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const [handlersMod, taskMod, agentMod] = await Promise.all([
    server.ssrLoadModule('/src/mocks/handlers.ts'),
    server.ssrLoadModule('/src/mocks/task-model/handlers.ts'),
    server.ssrLoadModule('/src/mocks/agent/handlers.ts'),
  ])

  const packed = [handlersMod.handlers, taskMod.taskModelHandlers, agentMod.agentHandlers]
  const handlers: MswHandler[] = packed.flatMap((group) =>
    Array.isArray(group) ? group.filter(isMswHandler) : [],
  )

  const method = (req.method ?? 'GET').toUpperCase()
  const host = req.headers.host ?? 'localhost:5173'
  const url = `http://${host}${req.url ?? '/'}`
  const headers = new Headers()
  const contentType = req.headers['content-type']
  if (typeof contentType === 'string') headers.set('content-type', contentType)

  const canHaveBody = method !== 'GET' && method !== 'HEAD'
  const rawBody = canHaveBody ? await readRequestBody(req) : undefined
  const requestInit: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
  }
  if (rawBody && rawBody.length > 0) {
    requestInit.body = Uint8Array.from(rawBody)
    requestInit.duplex = 'half'
  }
  const request = new Request(url, requestInit)
  const requestId = randomUUID()
  const baseUrl = `http://${host}`

  for (const handler of handlers) {
    const result = await handler.run({
      request: request.clone(),
      requestId,
      resolutionContext: { baseUrl },
    })
    const response = result?.response
    if (!response) continue
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    res.end(Buffer.from(await response.arrayBuffer()))
    return true
  }

  return false
}

function mockApiPlugin(enabled: boolean): Plugin {
  return {
    name: 'qgents-msw-dev-middleware',
    configureServer(server) {
      if (!enabled) return
      console.info('[mock-api] VITE_USE_MOCK=true，/api 由本地 MSW handlers 响应，不转发公网')
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          next()
          return
        }
        void respondWithMsw(server, req, res)
          .then((handled) => {
            if (handled) return
            jsonError(
              res,
              404,
              'MOCK_NOT_FOUND',
              `Mock 未覆盖 ${req.method ?? 'GET'} ${req.url ?? '/'}`,
            )
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            console.error('[mock-api]', error)
            jsonError(res, 500, 'MOCK_LOAD_FAILED', message)
          })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const useMock = env.VITE_USE_MOCK?.trim() === 'true'

  return {
    plugins: [react(), mockApiPlugin(useMock)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      port: 5173,
      allowedHosts: ['qgents.dpdns.org', 'mobile.qgents.dpdns.org'],
      proxy: useMock
        ? undefined
        : {
            '/api': {
              // target: 'https://api.qgents.dpdns.org',
              target: 'http://47.113.224.195:32500',//内网
              changeOrigin: true,
              // 避免 Tomcat/Nginx 对 Host 校验失败导致部分 POST 请求 502
              headers: { Host: '47.113.224.195:32500' },
              // WebSocket 实时通道（/api/v1/ws/realtime）握手升级需要转发
              ws: true,
              timeout: 60_000,
              proxyTimeout: 60_000,
              rewrite: (path) => path.replace(/^\/api/, '/api/v1'),
            },
          },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
    },
  }
})
