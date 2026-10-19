import { request } from './client'
import type { ApiResponse, CursorPage } from '@/types/api'

export function withQuery(path: string, values: object): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number') query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? `${path}?${encoded}` : path
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `qgents-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function requestData<T>(path: string, init?: Parameters<typeof request>[1]): Promise<T> {
  const response = await request<ApiResponse<T>>(path, { ...init, unwrapData: false })
  return response.data
}

export function requestPage<T>(path: string, init?: Parameters<typeof request>[1]): Promise<CursorPage<T>> {
  return request<CursorPage<T>>(path, init)
}

export function writeHeaders(): Record<string, string> {
  return { 'Idempotency-Key': createIdempotencyKey() }
}
