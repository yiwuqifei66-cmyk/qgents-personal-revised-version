import { request } from './client'
import type { TaskModelPage } from '@/types/task-model'

interface ModelApiResponse<T> {
  data: T
  requestId: string
}

export function withModelQuery(path: string, values: object): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number') query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? `${path}?${encoded}` : path
}

export async function requestModelData<T>(path: string, init?: Parameters<typeof request>[1]): Promise<T> {
  const response = await request<ModelApiResponse<T>>(path, { ...init, unwrapData: false })
  return response.data
}

export function requestModelPage<T>(
  path: string,
  init?: Parameters<typeof request>[1],
): Promise<TaskModelPage<T>> {
  return request<TaskModelPage<T>>(path, { ...init, unwrapData: false })
}

export function writeModelHeaders(): Record<string, string> {
  const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `qgents-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return { 'Idempotency-Key': idempotencyKey }
}
