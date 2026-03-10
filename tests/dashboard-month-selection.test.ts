import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureMonthSummary,
  resolveSelectedMonth,
} from '../frontend/src/features/dashboard/lib/dashboardSelectors'
import type { MonthSummary } from '../frontend/src/types'

function buildMonth(key: string, count = 0): MonthSummary {
  return {
    key,
    label: key,
    count,
  }
}

test('ensureMonthSummary inserts the current month in descending order when missing', () => {
  const months = [buildMonth('2026-02', 12), buildMonth('2026-01', 4)]

  const nextMonths = ensureMonthSummary(months, '2026-03')

  assert.deepEqual(
    nextMonths.map((month) => ({ key: month.key, count: month.count })),
    [
      { key: '2026-03', count: 0 },
      { key: '2026-02', count: 12 },
      { key: '2026-01', count: 4 },
    ]
  )
})

test('resolveSelectedMonth prefers the current calendar month on first load', () => {
  const months = [buildMonth('2026-03', 0), buildMonth('2026-02', 12), buildMonth('2026-01', 4)]

  const selectedMonth = resolveSelectedMonth(months, null, '2026-03')

  assert.equal(selectedMonth, '2026-03')
})

test('resolveSelectedMonth preserves an explicitly selected month when still available', () => {
  const months = [buildMonth('2026-03', 0), buildMonth('2026-02', 12), buildMonth('2026-01', 4)]

  const selectedMonth = resolveSelectedMonth(months, '2026-02', '2026-03')

  assert.equal(selectedMonth, '2026-02')
})
