import i18n from '../i18n'
import { DOSE_UNITS, formatDose } from './units'

const t = i18n.t.bind(i18n)

test('the unit list is exactly the spec list', () => {
  expect([...DOSE_UNITS]).toEqual(['ml', 'drops', 'mg', 'mcg', 'g', 'IU', 'tablet', 'puff'])
})

test('every unit has an i18n key', () => {
  for (const unit of DOSE_UNITS) {
    expect(t(`units.${unit}`, { count: 2 }), unit).not.toBe(`units.${unit}`)
  }
})

test('formatDose trims zeros, keeps decimals and pluralises the unit', () => {
  expect(formatDose(0.25, 'ml', t)).toBe('0.25 ml')
  expect(formatDose(5, 'drops', t)).toBe('5 drops')
  expect(formatDose(1, 'drops', t)).toBe('1 drop')
  expect(formatDose(1.5, 'tablet', t)).toBe('1.5 tablets')
  expect(formatDose(1, 'tablet', t)).toBe('1 tablet')
  expect(formatDose(100, 'mg', t)).toBe('100 mg')
  expect(formatDose(0.5, 'g', t)).toBe('0.5 g')
})

test('formatDose copes with float noise from sums', () => {
  expect(formatDose(0.1 + 0.2, 'ml', t)).toBe('0.3 ml')
})
