import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { ExpensesService, type ParsedExpenseTransaction } from '../server/expenses-service'

const repoRoot = path.resolve(__dirname, '..')
const fixturesRoot = path.join(repoRoot, 'tests', 'fixtures', 'statements')
const fixtureParserProfiles = {
  generic_numeric: 'generic_numeric',
  revolut: 'revolut_compact_statement',
  multiline: 'generic_numeric',
  bpi_account_activities_redacted: 'bpi_account_activities',
  revolut_usd_statement_redacted: 'revolut_usd_statement',
} as const

function loadFixture(caseName: string): [string, ParsedExpenseTransaction[]] {
  const caseRoot = path.join(fixturesRoot, caseName)
  const statementText = readFileSync(path.join(caseRoot, 'input.txt'), 'utf8')
  const expectedRows = JSON.parse(
    readFileSync(path.join(caseRoot, 'expected.json'), 'utf8')
  ) as ParsedExpenseTransaction[]
  return [statementText, expectedRows]
}

function createWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-'))
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

function openWorkspaceDb(root: string): Database.Database {
  const db = new Database(path.join(root, 'money_dashboard.db'))
  db.pragma('foreign_keys = ON')
  return db
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

for (const caseName of Object.keys(fixtureParserProfiles)) {
  test(`parsePdfLines matches fixture: ${caseName}`, () => {
    const service = new ExpensesService(repoRoot)
    const [statementText, expectedRows] = loadFixture(caseName)

    const parsedRows = service.parsePdfLines(statementText.split(/\r?\n/))

    assert.deepEqual(parsedRows, expectedRows)
  })
}

for (const [caseName, expectedProfile] of Object.entries(fixtureParserProfiles)) {
  test(`importPdfStatement preserves parser profile metadata: ${caseName}`, async (t) => {
    const root = createWorkspace()
    t.after(() => {
      rmSync(root, { recursive: true, force: true })
    })

    const [statementText] = loadFixture(caseName)
    const service = new ExpensesService(root)
    stubExtractedStatementText(service, statementText)

    const result = await service.importPdfStatement(
      `Parser profile ${caseName}`,
      `${caseName}.pdf`,
      Buffer.from('%PDF-1.4 fixture')
    )

    const batch = service.getImportBatch(result.batchId)

    assert.equal(batch.parserProfile, expectedProfile)
  })
}

test('fixture coverage exercises every active parser profile', () => {
  assert.deepEqual(
    new Set(Object.values(fixtureParserProfiles)),
    new Set([
      'generic_numeric',
      'bpi_account_activities',
      'revolut_compact_statement',
      'revolut_usd_statement',
    ])
  )
})

test('importPdfStatement deduplicates fixture rows', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const [statementText, expectedRows] = loadFixture('multiline')
  const service = new ExpensesService(root)
  stubExtractedStatementText(service, statementText)

  const firstImport = await service.importPdfStatement(
    'BPI USD Visa',
    'statement.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )
  const secondImport = await service.importPdfStatement(
    'BPI USD Visa',
    'statement.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  assert.equal(firstImport.ok, true)
  assert.equal(firstImport.parsedRows, expectedRows.length)
  assert.equal(firstImport.insertedTransactions, expectedRows.length)

  assert.equal(secondImport.ok, true)
  assert.equal(secondImport.parsedRows, expectedRows.length)
  assert.equal(secondImport.insertedTransactions, 0)

  const db = new Database(path.join(root, 'money_dashboard.db'))
  db.pragma('foreign_keys = ON')
  t.after(() => {
    db.close()
  })

  const rows = db
    .prepare(
      `
      SELECT tx_date, description, amount_original, currency
      FROM exp_transactions
      ORDER BY tx_date ASC, id ASC
      `
    )
    .all() as Array<{
    tx_date: string
    description: string
    amount_original: number
    currency: string
  }>

  assert.equal(rows.length, expectedRows.length)
  assert.deepEqual(
    rows.map((row) => row.tx_date),
    expectedRows.map((entry) => entry.tx_date)
  )
  assert.deepEqual(
    rows.map((row) => row.description),
    expectedRows.map((entry) => entry.description)
  )
  assert.deepEqual(
    rows.map((row) => row.amount_original),
    expectedRows.map((entry) => entry.amount)
  )
  assert.deepEqual(new Set(rows.map((row) => row.currency)), new Set(['USD']))

  const firstBatchRawRows = db
    .prepare(
      `
      SELECT status, transaction_id
      FROM exp_import_rows_raw
      WHERE batch_id = ?
      ORDER BY row_no ASC
      `
    )
    .all(firstImport.batchId) as Array<{ status: string; transaction_id: number | null }>
  const secondBatchRawRows = db
    .prepare(
      `
      SELECT status, transaction_id
      FROM exp_import_rows_raw
      WHERE batch_id = ?
      ORDER BY row_no ASC
      `
    )
    .all(secondImport.batchId) as Array<{ status: string; transaction_id: number | null }>

  assert.deepEqual(
    firstBatchRawRows.map((row) => row.status),
    new Array(expectedRows.length).fill('accepted')
  )
  assert.ok(firstBatchRawRows.every((row) => row.transaction_id != null))
  assert.deepEqual(
    secondBatchRawRows.map((row) => row.status),
    new Array(expectedRows.length).fill('duplicate')
  )
  assert.ok(secondBatchRawRows.every((row) => row.transaction_id == null))
})

test('importPdfStatement records accepted raw rows with review fields', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const [statementText, expectedRows] = loadFixture('generic_numeric')
  const service = new ExpensesService(root)
  stubExtractedStatementText(service, statementText)

  const result = await service.importPdfStatement(
    'Default Account',
    'statement.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  assert.equal(result.insertedTransactions, expectedRows.length)

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const statuses = db
    .prepare(
      `
      SELECT status, posted_date, merchant_candidate, reference_text, parse_notes, transaction_id
      FROM exp_import_rows_raw
      WHERE batch_id = ?
      ORDER BY row_no ASC
      `
    )
    .all(result.batchId) as Array<{
    status: string
    posted_date: string | null
    merchant_candidate: string | null
    reference_text: string | null
    parse_notes: string | null
    transaction_id: number | null
  }>

  assert.equal(statuses.length, expectedRows.length)
  assert.deepEqual(
    statuses.map((row) => row.status),
    new Array(expectedRows.length).fill('accepted')
  )
  assert.deepEqual(
    statuses.map((row) => row.posted_date),
    expectedRows.map((row) => row.tx_date)
  )
  assert.deepEqual(
    statuses.map((row) => row.reference_text),
    expectedRows.map((row) => row.description)
  )
  assert.ok(statuses.every((row) => row.merchant_candidate === row.reference_text))
  assert.ok(statuses.every((row) => row.parse_notes === 'accepted by generic parser fallback'))
  assert.ok(statuses.every((row) => row.transaction_id != null))

  const batch = service.getImportBatch(result.batchId)
  assert.equal(batch.parserProfile, 'generic_numeric')
})

test('importPdfStatement marks low-confidence and incomplete rows as needs_review', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  stubExtractedStatementText(service, 'ignored by stubbed parsePdfImportRows')
  stubParsedImportRows(service, [
    {
      txDate: '2026-01-03',
      postedDate: '2026-01-04',
      description: 'Possible coffee shop',
      amount: -120,
      confidence: 0.4,
      rawText: 'raw-low-confidence',
      merchantCandidate: 'Possible coffee shop',
      referenceText: 'Possible coffee shop',
      parseNotes: 'fallback parser match',
    },
    {
      txDate: null,
      postedDate: null,
      description: 'Missing date row',
      amount: -80,
      confidence: 0.98,
      rawText: 'raw-missing-date',
      merchantCandidate: 'Missing date row',
      referenceText: 'Missing date row',
      parseNotes: null,
    },
  ])

  const result = await service.importPdfStatement(
    'Review Account',
    'review.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  assert.deepEqual(result, {
    ok: true,
    batchId: result.batchId,
    parsedRows: 2,
    insertedTransactions: 0,
  })

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const reviewRows = db
    .prepare(
      `
      SELECT status, parse_notes, transaction_id
      FROM exp_import_rows_raw
      WHERE batch_id = ?
      ORDER BY row_no ASC
      `
    )
    .all(result.batchId) as Array<{
    status: string
    parse_notes: string | null
    transaction_id: number | null
  }>

  assert.deepEqual(
    reviewRows.map((row) => row.status),
    ['needs_review', 'needs_review']
  )
  assert.match(reviewRows[0]?.parse_notes || '', /confidence 0\.40 below import threshold/)
  assert.match(reviewRows[0]?.parse_notes || '', /fallback parser match/)
  assert.match(reviewRows[1]?.parse_notes || '', /missing transaction date/)
  assert.ok(reviewRows.every((row) => row.transaction_id == null))
})

test('import review service lists batches and supports accept/reject transitions', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  stubExtractedStatementText(service, 'ignored by stubbed parsePdfImportRows')
  stubParsedImportRows(service, [
    {
      txDate: '2026-02-10',
      postedDate: '2026-02-11',
      description: 'Manual review coffee',
      amount: -275,
      confidence: 0.42,
      rawText: 'review-coffee',
      merchantCandidate: 'Manual review coffee',
      referenceText: 'Manual review coffee',
      parseNotes: 'fallback parser match',
    },
  ])

  const importResult = await service.importPdfStatement(
    'Review Wallet',
    'review-wallet.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const importedRow = db
    .prepare(
      `
      SELECT id
      FROM exp_import_rows_raw
      WHERE batch_id = ?
      LIMIT 1
      `
    )
    .get(importResult.batchId) as { id: number }

  const listedBatch = service.listImportBatches().find((batch) => batch.id === importResult.batchId)
  assert.ok(listedBatch)
  assert.deepEqual(listedBatch?.counts, {
    parsed: 0,
    accepted: 0,
    rejected: 0,
    duplicate: 0,
    needs_review: 1,
  })

  const accepted = await service.acceptImportRow(importedRow.id)
  assert.equal(accepted.row.status, 'accepted')
  assert.ok(accepted.row.transactionId != null)
  assert.deepEqual(accepted.batch.counts, {
    parsed: 0,
    accepted: 1,
    rejected: 0,
    duplicate: 0,
    needs_review: 0,
  })

  const rejected = service.rejectImportRow(importedRow.id)
  assert.equal(rejected.row.status, 'rejected')
  assert.equal(rejected.row.transactionId, null)
  assert.deepEqual(rejected.batch.counts, {
    parsed: 0,
    accepted: 0,
    rejected: 1,
    duplicate: 0,
    needs_review: 0,
  })

  const txCount = Number(
    (
      db.prepare('SELECT COUNT(*) AS count FROM exp_transactions').get() as {
        count: number
      }
    ).count
  )
  assert.equal(txCount, 0)
})

test('importPdfStatement populates merchant_id without rewriting descriptions', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  stubExtractedStatementText(service, '2026-01-03 Card Payment Starbucks-BGC -150.00\n')

  const firstImport = await service.importPdfStatement(
    'Merchant Wallet',
    'merchant-a.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  stubExtractedStatementText(service, '2026-01-04 CARD PAYMENT starbucks bgc -175.00\n')
  const secondImport = await service.importPdfStatement(
    'Merchant Wallet',
    'merchant-b.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  assert.equal(firstImport.insertedTransactions, 1)
  assert.equal(secondImport.insertedTransactions, 1)

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const merchants = db
    .prepare(
      `
      SELECT id, name, normalized_name
      FROM exp_merchants
      ORDER BY id ASC
      `
    )
    .all() as Array<{ id: number; name: string; normalized_name: string | null }>
  const transactions = db
    .prepare(
      `
      SELECT description, merchant_id
      FROM exp_transactions
      ORDER BY tx_date ASC, id ASC
      `
    )
    .all() as Array<{ description: string; merchant_id: number | null }>

  assert.equal(merchants.length, 1)
  assert.equal(merchants[0]?.normalized_name, 'starbucks bgc')
  assert.deepEqual(
    transactions.map((row) => row.description),
    ['Card Payment Starbucks-BGC', 'CARD PAYMENT starbucks bgc']
  )
  assert.deepEqual(
    new Set(transactions.map((row) => row.merchant_id)),
    new Set([merchants[0]?.id ?? null])
  )
})

test('createCategorizationRuleFromTransaction affects subsequent imports', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  stubExtractedStatementText(service, '2026-01-03 Bookshop Purchase -150.00\n')

  const firstImport = await service.importPdfStatement(
    'Rules Wallet',
    'rules-a.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const shoppingCategoryId = Number(
    (
      db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Shopping') as {
        id: number
      }
    ).id
  )
  const importedTransaction = db
    .prepare(
      `
      SELECT id
      FROM exp_transactions
      WHERE import_batch_id = ?
      LIMIT 1
      `
    )
    .get(firstImport.batchId) as { id: number }

  const createdRule = service.createCategorizationRuleFromTransaction({
    transactionId: importedTransaction.id,
    categoryId: shoppingCategoryId,
    accountScoped: true,
  })

  assert.equal(createdRule.categoryName, 'Shopping')
  assert.equal(createdRule.accountName, 'Rules Wallet')

  stubExtractedStatementText(service, '2026-01-04 Bookshop Purchase -175.00\n')
  const secondImport = await service.importPdfStatement(
    'Rules Wallet',
    'rules-b.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  const secondTransactionCategory = db
    .prepare(
      `
      SELECT c.name AS category_name
      FROM exp_transactions AS t
      LEFT JOIN exp_categories AS c ON c.id = t.category_id
      WHERE t.import_batch_id = ?
      LIMIT 1
      `
    )
    .get(secondImport.batchId) as { category_name: string | null }

  assert.equal(secondTransactionCategory.category_name, 'Shopping')
})

test('importPdfStatement prefers account-scoped categorization rules over global rules', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  stubExtractedStatementText(service, '2026-01-03 Netflix 9.99\n')
  service.ensureSchema()

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const diningCategoryId = Number(
    (db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Dining') as { id: number }).id
  )
  const subscriptionsCategoryId = Number(
    (
      db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Subscriptions') as {
        id: number
      }
    ).id
  )
  const groceriesCategoryId = Number(
    (
      db.prepare('SELECT id FROM exp_categories WHERE name = ?').get('Groceries') as {
        id: number
      }
    ).id
  )
  const accountAId = Number(
    db.prepare('INSERT INTO exp_accounts(name, currency) VALUES(?, ?)').run('Personal PHP', 'PHP')
      .lastInsertRowid
  )
  const accountBId = Number(
    db.prepare('INSERT INTO exp_accounts(name, currency) VALUES(?, ?)').run('Joint PHP', 'PHP')
      .lastInsertRowid
  )

  db.prepare(
    `
    INSERT INTO exp_categorization_rules(priority, match_type, pattern, category_id, account_id, active)
    VALUES(?, ?, ?, ?, ?, 1)
    `
  ).run(10, 'contains', 'netflix', diningCategoryId, accountAId)
  db.prepare(
    `
    INSERT INTO exp_categorization_rules(priority, match_type, pattern, category_id, account_id, active)
    VALUES(?, ?, ?, ?, ?, 1)
    `
  ).run(20, 'contains', 'netflix', groceriesCategoryId, null)
  db.prepare(
    `
    INSERT INTO exp_categorization_rules(priority, match_type, pattern, category_id, account_id, active)
    VALUES(?, ?, ?, ?, ?, 1)
    `
  ).run(10, 'contains', 'netflix', subscriptionsCategoryId, accountBId)

  await service.importPdfStatement('Personal PHP', 'account-a.pdf', Buffer.from('%PDF-1.4 fixture'))
  stubExtractedStatementText(service, '2026-01-04 Netflix 9.99\n')
  await service.importPdfStatement('Joint PHP', 'account-b.pdf', Buffer.from('%PDF-1.4 fixture'))

  const rows = db
    .prepare(
      `
      SELECT a.name AS account_name, c.name AS category_name
      FROM exp_transactions AS t
      INNER JOIN exp_accounts AS a ON a.id = t.account_id
      LEFT JOIN exp_categories AS c ON c.id = t.category_id
      ORDER BY a.id ASC
      `
    )
    .all() as Array<{ account_name: string; category_name: string | null }>

  assert.deepEqual(rows, [
    { account_name: 'Personal PHP', category_name: 'Dining' },
    { account_name: 'Joint PHP', category_name: 'Subscriptions' },
  ])
})

test('importPdfStatement allows identical business keys across accounts', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  stubExtractedStatementText(service, '2026-01-03 Coffee Shop -9.99\n')

  const firstImport = await service.importPdfStatement(
    'Wallet A',
    'wallet-a.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )
  const secondImport = await service.importPdfStatement(
    'Wallet B',
    'wallet-b.pdf',
    Buffer.from('%PDF-1.4 fixture')
  )

  assert.equal(firstImport.insertedTransactions, 1)
  assert.equal(secondImport.insertedTransactions, 1)

  const db = openWorkspaceDb(root)
  t.after(() => {
    db.close()
  })

  const rows = db
    .prepare(
      `
      SELECT a.name AS account_name, t.tx_date, t.description, t.amount
      FROM exp_transactions AS t
      INNER JOIN exp_accounts AS a ON a.id = t.account_id
      ORDER BY t.id ASC
      `
    )
    .all() as Array<{
    account_name: string
    tx_date: string
    description: string
    amount: number
  }>

  assert.deepEqual(rows, [
    {
      account_name: 'Wallet A',
      tx_date: '2026-01-03',
      description: 'Coffee Shop',
      amount: -9.99,
    },
    {
      account_name: 'Wallet B',
      tx_date: '2026-01-03',
      description: 'Coffee Shop',
      amount: -9.99,
    },
  ])
})

test('regression: backfillFx rewrites all rows for a currency', async (t) => {
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
    db.prepare('INSERT INTO exp_accounts(name, currency) VALUES(?, ?)').run('USD Account', 'USD')
      .lastInsertRowid
  )

  db.prepare(
    `
    INSERT INTO exp_fx_rates(base_currency, quote_currency, rate_date, rate, provider)
    VALUES
      ('USD', 'PHP', '2026-01-03', 58.00, 'test'),
      ('USD', 'PHP', '2026-01-04', 57.50, 'test')
    `
  ).run()

  const insertTransaction = db.prepare(
    `
    INSERT INTO exp_transactions(
      account_id,
      tx_date,
      description,
      amount,
      currency,
      amount_original,
      amount_home,
      fx_rate_used,
      fx_date,
      source_hash
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )

  insertTransaction.run(
    accountId,
    '2026-01-03',
    'SaaS charge',
    -10,
    'USD',
    -10,
    -999,
    99,
    '2026-01-01',
    'usd-1'
  )
  insertTransaction.run(
    accountId,
    '2026-01-04',
    'Another SaaS charge',
    -20,
    'USD',
    -20,
    -999,
    99,
    '2026-01-01',
    'usd-2'
  )

  const result = await service.backfillFx()

  assert.deepEqual(result, { ok: true, updated: 2 })

  const rows = db
    .prepare(
      `
      SELECT tx_date, amount_home, fx_rate_used, fx_date
      FROM exp_transactions
      WHERE currency = 'USD'
      ORDER BY id ASC
      `
    )
    .all() as Array<{
    tx_date: string
    amount_home: number
    fx_rate_used: number
    fx_date: string
  }>

  assert.deepEqual(rows, [
    {
      tx_date: '2026-01-03',
      amount_home: -580,
      fx_rate_used: 58,
      fx_date: '2026-01-03',
    },
    {
      tx_date: '2026-01-04',
      amount_home: -1150,
      fx_rate_used: 57.5,
      fx_date: '2026-01-04',
    },
  ])
})

test('cleanupExistingTransactionDescriptions normalizes legacy bank rows', (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  service.ensureSchema()

  const db = new Database(path.join(root, 'money_dashboard.db'))
  db.pragma('foreign_keys = ON')
  t.after(() => {
    db.close()
  })

  const accountId = Number(
    db
      .prepare('INSERT INTO exp_accounts(name, currency) VALUES(?, ?)')
      .run('BPI 012450074240', 'PHP').lastInsertRowid
  )

  db.prepare(
    `
    INSERT INTO exp_transactions(
      account_id,
      tx_date,
      description,
      amount,
      currency,
      amount_original,
      amount_home,
      source_hash
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    accountId,
    '2026-02-28',
    'INTEREST PAY SYS-GEN INTEREST PAY SYS-GEN',
    4.15,
    'PHP',
    4.15,
    4.15,
    'legacy-interest'
  )
  db.prepare(
    `
    INSERT INTO exp_transactions(
      account_id,
      tx_date,
      description,
      amount,
      currency,
      amount_original,
      amount_home,
      source_hash
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    accountId,
    '2026-02-26',
    'POS W/D SV SOFT HABIT QUEZON CITY MLIC POS W/D SV SOFT HABIT QUEZON CITY MLIC',
    -320,
    'PHP',
    -320,
    -320,
    'legacy-soft-habit'
  )

  service.cleanupExistingTransactionDescriptions(db)

  const rows = db
    .prepare(
      `
      SELECT description
      FROM exp_transactions
      ORDER BY id ASC
      `
    )
    .all() as Array<{ description: string }>

  assert.deepEqual(
    rows.map((row) => row.description),
    ['Interest payment', 'Soft Habit']
  )
})
