import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  // older tests enter temperatures in °C; tests about °F (the app default) set the unit themselves
  localStorage.setItem('kinnest.tempUnit', 'C')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
