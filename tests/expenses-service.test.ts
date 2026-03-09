import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { ExpensesService, type ParsedExpenseTransaction } from '../server/expenses-service'

const repoRoot = path.resolve(__dirname, '..')
const fixturesRoot = path.join(repoRoot, 'tests', 'fixtures', 'statements')

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

for (const caseName of [
  'generic_numeric',
  'revolut',
  'multiline',
  'bpi_account_activities_redacted',
  'revolut_usd_statement_redacted',
]) {
  test(`parsePdfLines matches fixture: ${caseName}`, () => {
    const service = new ExpensesService(repoRoot)
    const [statementText, expectedRows] = loadFixture(caseName)

    const parsedRows = service.parsePdfLines(statementText.split(/\r?\n/))

    assert.deepEqual(parsedRows, expectedRows)
  })
}

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
})

test('regression: accepted raw import rows remain parsed', async (t) => {
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
      SELECT status
      FROM exp_import_rows_raw
      WHERE batch_id = ?
      ORDER BY row_no ASC
      `
    )
    .all(result.batchId) as Array<{ status: string }>

  assert.equal(statuses.length, expectedRows.length)
  assert.deepEqual(
    statuses.map((row) => row.status),
    new Array(expectedRows.length).fill('parsed')
  )
})

test('regression: pickCategory ignores account-scoped rules', async (t) => {
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
    { account_name: 'Joint PHP', category_name: 'Dining' },
  ])
})

test('regression: business-key dedupe ignores account_id', async (t) => {
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
  assert.equal(secondImport.insertedTransactions, 0)

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
