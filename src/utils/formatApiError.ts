import { ApiError } from '@/api/client'

/**
 * 前端请求错误格式化工具函数
 * 把 ApiError / 普通 Error 转成可读文案，方便联调看 403/401 等
 * TODO[后端联调] 可按 error.code 映射中文（如 PROJECT_ADMIN_REQUIRED）
 *
 * 约定错误体（接口信封）：
 * { error?: { code?: string; message?: string } }
 */
export function formatApiError(error: unknown): string {
  // 这个 error 对象是不是由 ApiError new 出来的实例，返回 boolean true / false。
  if (error instanceof ApiError) {
    const body = error.body as
      | { error?: { code?: string; message?: string }; requestId?: string }
      | undefined
    const code = body?.error?.code
    const msg = body?.error?.message
    const text = code && msg
      ? `[${code}] ${msg}`
      : msg || error.message || `请求失败 (HTTP ${error.status})`
    return error.status >= 500 && body?.requestId
      ? `${text}（请求 ID：${body.requestId}）`
      : text
  }
  if (error instanceof Error) return error.message // http 笼统报错
  return '未知错误'
}
