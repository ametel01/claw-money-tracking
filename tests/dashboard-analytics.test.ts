import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { buildSpendingPaceChart } from '../frontend/src/lib/analytics'
import type { TransactionRecord } from '../frontend/src/types'
import { ExpensesService } from '../server/expenses-service'

const repoRoot = path.resolve(__dirname, '..')

function createWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-analytics-'))
  mkdirSync(path.join(root, 'expenses'), { recursive: true })
  copyFileSync(
    path.join(repoRoot, 'expenses', 'schema.sql'),
    path.join(root, 'expenses', 'schema.sql')
  )
  return root
}

function openWorkspaceDb(root: string): Database.Database {
  const db = new Database(path.join(root, 'money_dashboard.db'))
  db.pragma('foreign_keys = ON')
  return db
}

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

test('server analytics endpoints aggregate monthly summaries from amount_home', (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  service.ensureSchema()

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const accountId = Number(
    db
      .prepare('INSERT INTO exp_accounts(name, currency) VALUES(?, ?)')
      .run('Analytics Wallet', 'USD').lastInsertRowid
  )
  const groceriesCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Groceries') as { id: number })
      .id
  )
  const salaryCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Salary') as { id: number }).id
  )
  const transferCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Transfer') as { id: number })
      .id
  )
  const merchantId = Number(
    db
      .prepare('INSERT INTO exp_merchants(name, normalized_name) VALUES(?, ?)')
      .run('Merchant Alpha', 'merchant alpha').lastInsertRowid
  )
  const insertTransaction = db.prepare(
    `
    INSERT INTO exp_transactions(
      account_id,
      tx_date,
      posted_date,
      description,
      merchant_id,
      category_id,
      amount,
      currency,
      amount_original,
      amount_home,
      fx_rate_used,
      fx_date,
      source_hash
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )

  insertTransaction.run(
    accountId,
    '2026-02-05',
    '2026-02-05',
    'Merchant Alpha',
    merchantId,
    groceriesCategoryId,
    -10,
    'USD',
    -10,
    -580,
    58,
    '2026-02-05',
    'analytics-1'
  )
  insertTransaction.run(
    accountId,
    '2026-02-09',
    '2026-02-09',
    'Salary',
    null,
    salaryCategoryId,
    50,
    'USD',
    50,
    2900,
    58,
    '2026-02-09',
    'analytics-2'
  )
  insertTransaction.run(
    accountId,
    '2026-01-11',
    '2026-01-11',
    'Merchant Alpha',
    merchantId,
    groceriesCategoryId,
    -5,
    'USD',
    -5,
    -290,
    58,
    '2026-01-11',
    'analytics-3'
  )
  insertTransaction.run(
    accountId,
    '2026-01-12',
    '2026-01-12',
    'Savings transfer',
    null,
    transferCategoryId,
    -100,
    'USD',
    -100,
    -5800,
    58,
    '2026-01-12',
    'analytics-4'
  )

  const monthlySummary = service.getMonthlyAnalyticsSummary()
  const categoryBreakdown = service.getCategoryBreakdown('2026-02')
  const cashFlow = service.getCashFlow()
  const merchantLeaderboard = service.getMerchantLeaderboard('2026-02')

  assert.deepEqual(monthlySummary.slice(0, 2), [
    {
      month: '2026-02',
      income: 2900,
      expenses: 580,
      net: 2320,
      transactionCount: 2,
    },
    {
      month: '2026-01',
      income: 0,
      expenses: 290,
      net: -290,
      transactionCount: 2,
    },
  ])
  assert.deepEqual(categoryBreakdown, [
    {
      categoryName: 'Groceries',
      total: 580,
      percentage: 100,
      transactionCount: 1,
    },
  ])
  assert.deepEqual(cashFlow.slice(0, 2), [
    {
      month: '2026-02',
      income: 2900,
      expenses: 580,
      net: 2320,
    },
    {
      month: '2026-01',
      income: 0,
      expenses: 290,
      net: -290,
    },
  ])
  assert.deepEqual(merchantLeaderboard, [
    {
      merchantId,
      merchantName: 'Merchant Alpha',
      total: 580,
      transactionCount: 1,
      lastTransactionDate: '2026-02-05',
    },
  ])
})

test('server spending pace model matches the existing chart semantics', (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  service.ensureSchema()

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const accountId = Number(
    db.prepare('INSERT INTO exp_accounts(name, currency) VALUES(?, ?)').run('Pace Wallet', 'PHP')
      .lastInsertRowid
  )
  const groceriesCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Groceries') as { id: number })
      .id
  )
  const billsCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Bills') as { id: number }).id
  )
  const insertTransaction = db.prepare(
    `
    INSERT INTO exp_transactions(
      account_id,
      tx_date,
      posted_date,
      description,
      category_id,
      amount,
      currency,
      amount_original,
      amount_home,
      fx_rate_used,
      fx_date,
      source_hash
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
  const rows: TransactionRecord[] = [
    makeExpense(1, '2026-02-01', -100, 'Groceries', 'Groceries'),
    makeExpense(2, '2026-02-03', -50, 'Coffee', 'Dining'),
    makeExpense(3, '2026-02-10', -200, 'Rent', 'Bills'),
    makeExpense(4, '2026-01-01', -80, 'Week one groceries', 'Groceries'),
    makeExpense(5, '2026-01-05', -120, 'Utilities', 'Bills'),
  ]

  for (const row of rows) {
    insertTransaction.run(
      accountId,
      row.tx_date,
      row.tx_date,
      row.description,
      row.category_name === 'Bills' ? billsCategoryId : groceriesCategoryId,
      row.amount,
      'PHP',
      row.amount_original,
      row.amount_home,
      1,
      row.tx_date,
      `pace-${row.id}`
    )
  }

  const model = service.getSpendingPaceModel('2026-02')

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
