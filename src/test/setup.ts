import '@testing-library/jest-dom/vitest'

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class TestResizeObserver implements ResizeObserver {
    disconnect(): void {}
    observe(_target: Element, _options?: ResizeObserverOptions): void {}
    unobserve(_target: Element): void {}
  }
  globalThis.ResizeObserver = TestResizeObserver
}

/**
 * Vitest 全局 setup
 * TODO: 联调阶段可在此启用 MSW（src/mocks/browser.ts）
 */
