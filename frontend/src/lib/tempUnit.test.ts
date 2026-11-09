import { beforeEach, expect, test } from 'vitest'
import i18n from '../i18n'
import { cToF, fToC, getTempUnit, setTempUnit } from './tempUnit'
import { validateVital } from './vitals'
import { formatValue } from './vitalsFormat'

const t = i18n.t.bind(i18n)

beforeEach(() => localStorage.clear())

test('Fahrenheit is the default unit and the choice is remembered', () => {
  expect(getTempUnit()).toBe('F')
  setTempUnit('C')
  expect(getTempUnit()).toBe('C')
  expect(localStorage.getItem('kinnest.tempUnit')).toBe('C')
})

test('conversions round to one decimal and the fever line is 100.4 °F', () => {
  expect(cToF(38)).toBe(100.4)
  expect(cToF(37)).toBe(98.6)
  expect(fToC(99.5)).toBe(37.5)
  expect(fToC(98.6)).toBe(37)
})

test('a stored °C reading is shown in °F by default and in °C when chosen', () => {
  expect(formatValue(t, 'temperature_c', 37)).toBe('98.6 °F')
  setTempUnit('C')
  expect(formatValue(t, 'temperature_c', 37)).toBe('37 °C')
  expect(formatValue(t, 'weight_kg', 3.4)).toBe('3.4 kg')
})

test('in °F the range message is in °F and there is no "looks like Fahrenheit" hint', () => {
  const bad = validateVital({ id: 'x', measured_at: new Date().toISOString(), place_kind: 'home', temperature_c: fToC(120) })
  expect(bad.temperature_c).toMatch(/86.*113.*°F/)
  expect(bad.temperature_c).not.toMatch(/looks like Fahrenheit/)
})
