import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { ExpensesService } from '../server/expenses-service'

const repoRoot = path.resolve(__dirname, '..')

function createWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-budgets-'))
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

test('budget periods compute category actual-vs-target totals', (t) => {
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
    db.prepare('INSERT INTO exp_accounts(name, currency) VALUES(?, ?)').run('Budget Wallet', 'PHP')
      .lastInsertRowid
  )
  const groceriesCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Groceries') as { id: number })
      .id
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

  insertTransaction.run(
    accountId,
    '2026-02-03',
    '2026-02-03',
    'Groceries',
    groceriesCategoryId,
    -580,
    'PHP',
    -580,
    -580,
    1,
    '2026-02-03',
    'budget-1'
  )

  const period = service.createBudgetPeriod({ month: '2026-02', budgetName: 'Home Budget' })
  const updatedPeriod = service.upsertBudgetTarget(period.id, groceriesCategoryId, 1000)

  assert.equal(updatedPeriod.month, '2026-02')
  assert.equal(updatedPeriod.budgetName, 'Home Budget')
  assert.deepEqual(updatedPeriod.targets, [
    {
      id: updatedPeriod.targets[0]?.id ?? 0,
      categoryId: groceriesCategoryId,
      categoryName: 'Groceries',
      targetAmount: 1000,
      actualAmount: 580,
      remainingAmount: 420,
    },
  ])

  const listedPeriods = service.listBudgetPeriods()
  assert.equal(listedPeriods[0]?.id, updatedPeriod.id)
  assert.equal(listedPeriods[0]?.targets[0]?.actualAmount, 580)
})
