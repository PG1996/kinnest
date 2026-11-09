import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useCountUp } from './motion'
import { resolveTheme } from './theme'

const at = (h: number, m = 0) => new Date(2026, 10, 8, h, m)

describe('resolveTheme', () => {
  test('night is dark at 23:30 and 05:59 and light at 06:00 and 21:59', () => {
    expect(resolveTheme('night', at(23, 30), false)).toBe('dark')
    expect(resolveTheme('night', at(5, 59), false)).toBe('dark')
    expect(resolveTheme('night', at(6, 0), true)).toBe('light')
    expect(resolveTheme('night', at(21, 59), true)).toBe('light')
    expect(resolveTheme('night', at(22, 0), false)).toBe('dark')
  })
  test('auto follows prefersDark', () => {
    expect(resolveTheme('auto', at(12), true)).toBe('dark')
    expect(resolveTheme('auto', at(12), false)).toBe('light')
  })
  test('light and dark are fixed', () => {
    expect(resolveTheme('light', at(2), true)).toBe('light')
    expect(resolveTheme('dark', at(12), false)).toBe('dark')
  })
})

describe('useCountUp', () => {
  afterEach(() => vi.unstubAllGlobals())
  test('returns the target immediately under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const { result } = renderHook(() => useCountUp(130))
    expect(result.current).toBe(130)
  })
  test('returns the target immediately when matchMedia is missing', () => {
    const { result } = renderHook(() => useCountUp(42))
    expect(result.current).toBe(42)
  })
})
