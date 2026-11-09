import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Button } from './button'
import { Input, Select } from './field'

test('inputs are sleek: 40px tall, with 16px text so iPhones do not zoom', () => {
  render(<Input aria-label="x" />)
  const cls = screen.getByLabelText('x').className
  expect(cls).toContain('min-h-10')
  expect(cls).toContain('text-base')
  expect(cls).not.toContain('min-h-11')
  render(<Select aria-label="y" />)
  expect(screen.getByLabelText('y').className).toContain('min-h-10')
})

test('buttons are 44px by default and 48px when large', () => {
  render(<Button>Default</Button>)
  render(<Button size="lg">Large</Button>)
  expect(screen.getByRole('button', { name: 'Default' }).className).toContain('min-h-11')
  expect(screen.getByRole('button', { name: 'Large' }).className).toContain('min-h-12')
})

test('screens use the calm type scale: no extrabold, no headings above text-xl, no 5xl numbers', () => {
  const root = join(__dirname, '..', '..')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : n.endsWith('.tsx') && !n.includes('.test.') ? [p] : []
    })
  const loud = /font-extrabold|text-2xl|text-3xl|text-4xl|text-5xl|text-\[2\.1rem\]/
  const offenders = walk(root).filter((f) => loud.test(readFileSync(f, 'utf8'))).map((f) => f.replace(root + '/', ''))
  expect(offenders).toEqual([])
})
