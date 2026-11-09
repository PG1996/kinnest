import { expect, test } from 'vitest'
import { fitWithin } from './image'

test('fitWithin keeps small images as they are', () => {
  expect(fitWithin(1200, 800, 2000)).toEqual({ width: 1200, height: 800 })
})

test('fitWithin shrinks the long side to the limit and keeps the ratio', () => {
  expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 })
  expect(fitWithin(3000, 6000, 2000)).toEqual({ width: 1000, height: 2000 })
})

test('fitWithin never returns a zero side', () => {
  expect(fitWithin(10000, 1, 2000)).toEqual({ width: 2000, height: 1 })
})
