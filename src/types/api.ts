export interface ApiErrorDetail {
  code: string
  message: string
  field?: string
}

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: ApiErrorDetail[]
  }
  requestId?: string
}

export interface ApiResponse<T> {
  data: T
  requestId?: string
}

export interface CursorPage<T> {
  data: T[]
  page: {
    nextCursor: string | null
    hasMore: boolean
  }
  requestId?: string
}
