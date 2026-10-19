import { useEffect, useState } from 'react'

/**
 * 缓存 `value` 并在 `delayMs` 稳定后才返回更新后的版本，常用于把高频输入
 * （例如每个 keystroke）转换为稳定的状态，驱动 URL 参数或查询条件，避免
 * 列表抖动和重复请求。
 *
 * 注意：仅在 `value` 真正变化时才会启动新的延时；同一帧内的多次更新共用同一个 timer。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value)
      return
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(handle)
  }, [value, delayMs])

  return debounced
}
