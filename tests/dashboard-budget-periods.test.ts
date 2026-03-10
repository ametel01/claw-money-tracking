import assert from 'node:assert/strict'
import test from 'node:test'
import type { BudgetPeriodRecord } from '../frontend/src/types'
import { upsertBudgetPeriodList } from '../frontend/src/features/dashboard/hooks/useExpensesDashboard'

function buildPeriod(overrides: Partial<BudgetPeriodRecord>): BudgetPeriodRecord {
  return {
    id: 1,
    budgetId: 1,
    budgetName: 'Default Budget',
    month: '2026-03',
    currency: 'PHP',
    createdAt: '2026-03-10T00:00:00.000Z',
    targets: [],
    ...overrides,
  }
}

test('upsertBudgetPeriodList inserts new periods in month-desc order', () => {
  const periods = [
    buildPeriod({ id: 2, month: '2026-02' }),
    buildPeriod({ id: 1, month: '2026-01' }),
  ]

  const inserted = upsertBudgetPeriodList(periods, buildPeriod({ id: 3, month: '2026-03' }))

  assert.deepEqual(
    inserted.map((period) => ({ id: period.id, month: period.month })),
    [
      { id: 3, month: '2026-03' },
      { id: 2, month: '2026-02' },
      { id: 1, month: '2026-01' },
    ]
  )
})

test('upsertBudgetPeriodList replaces an existing period in place with returned targets', () => {
  const current = buildPeriod({
    id: 8,
    month: '2026-03',
    targets: [],
  })
  const updated = buildPeriod({
    id: 8,
    month: '2026-03',
    targets: [
      {
        id: 22,
        categoryId: 4,
        categoryName: 'Groceries',
        targetAmount: 3500,
        actualAmount: 1200,
        remainingAmount: 2300,
      },
    ],
  })

  const merged = upsertBudgetPeriodList([current], updated)

  assert.deepEqual(merged, [updated])
})
