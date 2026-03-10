import assert from 'node:assert/strict'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { ExpensesService } from '../server/expenses-service'
import { createExpensesApp } from '../server/index'

const repoRoot = path.resolve(__dirname, '..')

function createWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-recurring-api-'))
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = (await response.json()) as T
  assert.equal(response.ok, true)
  return payload
}

test('recurring routes recompute series on demand and expose refreshed insights', async (t) => {
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
      .run('Recurring API Wallet', 'PHP').lastInsertRowid
  )
  const subscriptionsCategoryId = Number(
    (
      db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Subscriptions') as {
        id: number
      }
    ).id
  )
  const merchantId = Number(
    db
      .prepare('INSERT INTO exp_merchants(name, normalized_name) VALUES(?, ?)')
      .run('Music Box', 'music box').lastInsertRowid
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

  for (const [date, hash] of [
    ['2026-01-09', 'rec-api-1'],
    ['2026-02-09', 'rec-api-2'],
    ['2026-03-09', 'rec-api-3'],
  ] as const) {
    insertTransaction.run(
      accountId,
      date,
      date,
      'Music Box',
      merchantId,
      subscriptionsCategoryId,
      -399,
      'PHP',
      -399,
      -399,
      1,
      date,
      hash
    )
  }

  const app = createExpensesApp(service)
  const server = app.listen(0, '127.0.0.1')
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })
  await once(server, 'listening')

  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  const recomputed = await requestJson<{ ok: boolean; seriesCount: number; occurrenceCount: number }>(
    `${baseUrl}/api/expenses/recurring/recompute`,
    {
      method: 'POST',
    }
  )
  assert.deepEqual(recomputed, {
    ok: true,
    seriesCount: 1,
    occurrenceCount: 3,
  })

  const insights = await requestJson<{
    nextCharges: Array<{
      merchantName: string
      nextExpectedDate: string | null
      cadence: string
      occurrenceCount: number
    }>
    projectedRemainingFixedSpend: number
  }>(`${baseUrl}/api/expenses/recurring/insights?month=2026-03`)

  assert.equal(insights.nextCharges[0]?.merchantName, 'Music Box')
  assert.equal(insights.nextCharges[0]?.nextExpectedDate, '2026-04-09')
  assert.equal(insights.nextCharges[0]?.cadence, 'monthly')
  assert.equal(insights.nextCharges[0]?.occurrenceCount, 3)
  assert.equal(insights.projectedRemainingFixedSpend, 0)
})
