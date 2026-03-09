import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { ExpensesService } from '../server/expenses-service'

const repoRoot = path.resolve(__dirname, '..')

function createWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-recurring-'))
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

test('recomputeRecurringSeries persists monthly and annual series while ignoring transfer-like rows', (t) => {
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
      .run('Recurring Wallet', 'PHP').lastInsertRowid
  )
  const subscriptionsCategoryId = Number(
    (
      db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Subscriptions') as {
        id: number
      }
    ).id
  )
  const travelCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Travel') as { id: number }).id
  )
  const transferCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Transfer') as { id: number })
      .id
  )
  const spotifyMerchantId = Number(
    db
      .prepare('INSERT INTO exp_merchants(name, normalized_name) VALUES(?, ?)')
      .run('Spotify', 'spotify').lastInsertRowid
  )
  const insuranceMerchantId = Number(
    db
      .prepare('INSERT INTO exp_merchants(name, normalized_name) VALUES(?, ?)')
      .run('Travel Insurance', 'travel insurance').lastInsertRowid
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

  const rows = [
    ['2025-12-05', 'Spotify', spotifyMerchantId, subscriptionsCategoryId, -499, 'rec-1'],
    ['2026-01-05', 'Spotify', spotifyMerchantId, subscriptionsCategoryId, -499, 'rec-2'],
    ['2026-02-05', 'Spotify', spotifyMerchantId, subscriptionsCategoryId, -499, 'rec-3'],
    ['2025-03-10', 'Travel Insurance', insuranceMerchantId, travelCategoryId, -2400, 'rec-4'],
    ['2026-03-10', 'Travel Insurance', insuranceMerchantId, travelCategoryId, -2400, 'rec-5'],
    ['2026-01-02', 'Transfer to Savings', null, transferCategoryId, -1000, 'rec-6'],
    ['2026-02-02', 'Transfer to Savings', null, transferCategoryId, -1000, 'rec-7'],
  ] as const

  for (const [txDate, description, merchantId, categoryId, amount, hash] of rows) {
    insertTransaction.run(
      accountId,
      txDate,
      txDate,
      description,
      merchantId,
      categoryId,
      amount,
      'PHP',
      amount,
      amount,
      1,
      txDate,
      hash
    )
  }

  const recomputed = service.recomputeRecurringSeries()
  const insights = service.getRecurringInsights('2026-03')

  assert.deepEqual(recomputed, {
    ok: true,
    seriesCount: 2,
    occurrenceCount: 5,
  })
  assert.deepEqual(
    insights.nextCharges.map((series) => ({
      merchantName: series.merchantName,
      cadence: series.cadence,
      nextExpectedDate: series.nextExpectedDate,
    })),
    [
      {
        merchantName: 'Spotify',
        cadence: 'monthly',
        nextExpectedDate: '2026-03-05',
      },
      {
        merchantName: 'Travel Insurance',
        cadence: 'annual',
        nextExpectedDate: '2027-03-10',
      },
    ]
  )
  assert.equal(insights.likelySubscriptions[0]?.merchantName, 'Spotify')
  assert.equal(insights.projectedRemainingFixedSpend, 499)
})
