import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSpendingPaceChart } from '../frontend/src/lib/analytics'
import type { TransactionRecord } from '../frontend/src/types'

function makeExpense(
  id: number,
  txDate: string,
  amount: number,
  description: string,
  category = 'Food'
): TransactionRecord {
  return {
    id,
    tx_date: txDate,
    description,
    amount,
    amount_original: amount,
    amount_home: amount,
    currency: 'PHP',
    fx_rate_used: 1,
    account_name: 'Cash',
    account_currency: 'PHP',
    category_name: category,
    category_kind: 'expense',
  }
}

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

test('buildSpendingPaceChart summarizes a completed month against the previous month', () => {
  const rows: TransactionRecord[] = [
    makeExpense(1, '2026-02-01', -100, 'Groceries', 'Groceries'),
    makeExpense(2, '2026-02-03', -50, 'Coffee', 'Dining'),
    makeExpense(3, '2026-02-10', -200, 'Rent', 'Housing'),
    makeExpense(4, '2026-01-01', -80, 'Week one groceries', 'Groceries'),
    makeExpense(5, '2026-01-05', -120, 'Utilities', 'Bills'),
  ]

  const model = buildSpendingPaceChart(rows, '2026-02')

  assert.equal(model.monthKey, '2026-02')
  assert.equal(model.points.length, 28)
  assert.equal(model.total, 350)
  assert.equal(model.comparisonTotal, 200)
  assert.equal(model.projectedTotal, null)
  assert.equal(model.points[2]?.current, 150)
  assert.equal(model.points[2]?.previous, 80)
  assert.equal(model.largestDay?.day, 10)
  assert.equal(model.largestDay?.total, 200)
  assert.equal(model.largestDay?.transactions[0]?.description, 'Rent')
})

test('buildSpendingPaceChart projects the current month using elapsed days', () => {
  const today = new Date()
  const currentMonthKey = toMonthKey(today)
  const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const previousMonthKey = toMonthKey(previousMonth)
  const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()

  const rows: TransactionRecord[] = [
    makeExpense(1, `${currentMonthKey}-01`, -100, 'Start of month groceries', 'Groceries'),
    makeExpense(2, `${previousMonthKey}-01`, -50, 'Last month groceries', 'Groceries'),
  ]

  const model = buildSpendingPaceChart(rows, currentMonthKey)
  const expectedProjection = (100 / today.getDate()) * daysInCurrentMonth

  assert.equal(model.isCurrentMonth, true)
  assert.equal(model.total, 100)
  assert.equal(model.comparisonToDate, 50)
  assert.ok(model.projectedTotal != null)
  assert.ok(Math.abs((model.projectedTotal ?? 0) - expectedProjection) < 0.0001)
})
