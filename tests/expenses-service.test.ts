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
  ;(service as { extractPdfText: (pdfPath: string) => Promise<string> }).extractPdfText = async (
    _pdfPath
  ) => statementText

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
