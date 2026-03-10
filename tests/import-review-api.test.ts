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
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-api-'))
  mkdirSync(path.join(root, 'expenses'), { recursive: true })
  copyFileSync(
    path.join(repoRoot, 'expenses', 'schema.sql'),
    path.join(root, 'expenses', 'schema.sql')
  )
  return root
}

function stubExtractedStatementText(service: ExpensesService, statementText: string): void {
  ;(service as { extractPdfText: (pdfPath: string) => Promise<string> }).extractPdfText = async (
    _pdfPath
  ) => statementText
}

function stubParsedImportRows(
  service: ExpensesService,
  rows: Array<Record<string, unknown>>
): void {
  ;(
    service as {
      parsePdfDocument: (lines: string[]) => {
        parserProfile: string
        rows: Array<Record<string, unknown>>
      }
    }
  ).parsePdfDocument = (_lines) => ({
    parserProfile: 'generic_numeric',
    rows,
  })
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = (await response.json()) as T
  assert.equal(response.ok, true)
  return payload
}

test('import review routes expose batches and row transitions', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  stubExtractedStatementText(service, 'ignored by stubbed parsePdfImportRows')
  stubParsedImportRows(service, [
    {
      txDate: '2026-02-14',
      postedDate: '2026-02-15',
      description: 'Route review merchant',
      amount: -499,
      confidence: 0.41,
      rawText: 'route-review-row',
      merchantCandidate: 'Route review merchant',
      referenceText: 'Route review merchant',
      parseNotes: 'fallback parser match',
    },
  ])

  const importResult = await service.importPdfStatement(
    'API Review Wallet',
    'api-review.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  const app = createExpensesApp(service)
  const server = app.listen(0, '127.0.0.1')
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })
  await once(server, 'listening')

  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  const batches = await requestJson<
    Array<{
      id: number
      counts: { needs_review: number; accepted: number }
    }>
  >(`${baseUrl}/api/expenses/import-batches`)
  const batchSummary = batches.find((batch) => batch.id === importResult.batchId)
  assert.ok(batchSummary)
  assert.equal(batchSummary?.counts.needs_review, 1)

  const detail = await requestJson<{
    id: number
    rows: Array<{ id: number; status: string }>
  }>(`${baseUrl}/api/expenses/import-batches/${importResult.batchId}`)
  assert.equal(detail.id, importResult.batchId)
  assert.equal(detail.rows[0]?.status, 'needs_review')
  const rowId = detail.rows[0]?.id
  assert.ok(rowId != null)

  const accepted = await requestJson<{
    row: { status: string; transactionId: number | null }
    batch: {
      counts: {
        parsed: number
        accepted: number
        rejected: number
        duplicate: number
        needs_review: number
      }
    }
  }>(`${baseUrl}/api/expenses/import-rows/${rowId}/accept`, {
    method: 'POST',
  })
  assert.equal(accepted.row.status, 'accepted')
  assert.ok(accepted.row.transactionId != null)
  assert.deepEqual(accepted.batch.counts, {
    parsed: 0,
    accepted: 1,
    duplicate: 0,
    needs_review: 0,
    rejected: 0,
  })

  const rejected = await requestJson<{
    row: { status: string; transactionId: number | null }
    batch: {
      counts: {
        parsed: number
        accepted: number
        rejected: number
        duplicate: number
        needs_review: number
      }
    }
  }>(`${baseUrl}/api/expenses/import-rows/${rowId}/reject`, {
    method: 'POST',
  })
  assert.equal(rejected.row.status, 'rejected')
  assert.equal(rejected.row.transactionId, null)
  assert.deepEqual(rejected.batch.counts, {
    parsed: 0,
    accepted: 0,
    duplicate: 0,
    needs_review: 0,
    rejected: 1,
  })
})

test('categorization rule routes list and disable active rules', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  stubExtractedStatementText(service, '2026-01-03 Bookshop Purchase -150.00\n')

  const importResult = await service.importPdfStatement(
    'Rules API Wallet',
    'rules-api.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  const db = new Database(path.join(root, 'money_dashboard.db'))
  db.pragma('foreign_keys = ON')
  t.after(() => {
    db.close()
  })

  const transactionId = Number(
    (
      db
        .prepare('SELECT id FROM exp_transactions WHERE import_batch_id = ? LIMIT 1')
        .get(importResult.batchId) as { id: number }
    ).id
  )
  const shoppingCategoryId = Number(
    (
      db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Shopping') as {
        id: number
      }
    ).id
  )

  const app = createExpensesApp(service)
  const server = app.listen(0, '127.0.0.1')
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })
  await once(server, 'listening')

  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  const createdRule = await requestJson<{
    id: number
    active: boolean
    categoryName: string | null
  }>(`${baseUrl}/api/expenses/categorization-rules/from-transaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transactionId,
      categoryId: shoppingCategoryId,
      accountScoped: true,
    }),
  })

  assert.equal(createdRule.active, true)
  assert.equal(createdRule.categoryName, 'Shopping')

  const listedTransactions = await requestJson<
    Array<{
      id: number
      category_id: number | null
      category_name: string | null
    }>
  >(`${baseUrl}/api/expenses/transactions?limit=50000`)
  const categorizedTransaction = listedTransactions.find((transaction) => transaction.id === transactionId)
  assert.ok(categorizedTransaction)
  assert.equal(categorizedTransaction?.id, transactionId)
  assert.equal(categorizedTransaction?.category_id, shoppingCategoryId)
  assert.equal(categorizedTransaction?.category_name, 'Shopping')

  const listedRules = await requestJson<Array<{ id: number; active: boolean }>>(
    `${baseUrl}/api/expenses/categorization-rules`
  )
  assert.equal(listedRules.length, 1)
  assert.equal(listedRules[0]?.id, createdRule.id)

  const disabledRule = await requestJson<{ id: number; active: boolean }>(
    `${baseUrl}/api/expenses/categorization-rules/${createdRule.id}/disable`,
    {
      method: 'POST',
    }
  )
  assert.equal(disabledRule.id, createdRule.id)
  assert.equal(disabledRule.active, false)

  const listedAfterDisable = await requestJson<Array<{ id: number }>>(
    `${baseUrl}/api/expenses/categorization-rules`
  )
  assert.equal(listedAfterDisable.length, 0)
})
