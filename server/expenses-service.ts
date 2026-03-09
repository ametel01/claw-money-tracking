import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { buildSpendingPaceChart } from '../frontend/src/lib/analytics'
import type { LineChartModel, TransactionRecord } from '../frontend/src/types'

export interface ParsedExpenseTransaction {
  tx_date: string
  description: string
  amount: number
  confidence: number
}

interface ParsedImportRow {
  txDate: string | null
  postedDate: string | null
  description: string | null
  amount: number | null
  confidence: number
  rawText: string
  merchantCandidate: string | null
  referenceText: string | null
  parseNotes: string | null
}

type ParserProfile =
  | 'generic_numeric'
  | 'bpi_account_activities'
  | 'revolut_usd_statement'
  | 'revolut_compact_statement'

interface TableInfoRow {
  name: string
}

interface OverviewRow {
  income: number | null
  expenses: number | null
  tx_count: number | null
}

export interface ImportStatusCounts {
  parsed: number
  accepted: number
  rejected: number
  duplicate: number
  needs_review: number
}

export interface ImportBatchSummary {
  id: number
  sourceType: string
  sourceFilename: string | null
  accountId: number | null
  accountName: string | null
  parserProfile: string | null
  status: string
  totalRows: number
  insertedRows: number
  parseNotes: string | null
  createdAt: string
  counts: ImportStatusCounts
}

export interface ImportRowRecord {
  id: number
  batchId: number
  rowNo: number
  rawText: string
  parsedTxDate: string | null
  postedDate: string | null
  parsedDescription: string | null
  merchantCandidate: string | null
  referenceText: string | null
  parsedAmount: number | null
  confidence: number
  parseNotes: string | null
  status: string
  error: string | null
  transactionId: number | null
  createdAt: string
}

export interface ImportBatchDetail extends ImportBatchSummary {
  rows: ImportRowRecord[]
}

export interface ImportRowActionResult {
  row: ImportRowRecord
  batch: ImportBatchDetail
}

export interface CategorizationRuleRecord {
  id: number
  priority: number
  matchType: string
  pattern: string
  categoryId: number
  categoryName: string | null
  accountId: number | null
  accountName: string | null
  active: boolean
  createdAt: string
}

export interface MonthlyAnalyticsSummary {
  month: string
  income: number
  expenses: number
  net: number
  transactionCount: number
}

export interface CategoryBreakdownItem {
  categoryName: string
  total: number
  percentage: number
  transactionCount: number
}

export interface CashFlowPoint {
  month: string
  income: number
  expenses: number
  net: number
}

export interface MerchantLeaderboardItem {
  merchantId: number | null
  merchantName: string
  total: number
  transactionCount: number
  lastTransactionDate: string | null
}

export interface BudgetTargetRecord {
  id: number
  categoryId: number
  categoryName: string
  targetAmount: number
  actualAmount: number
  remainingAmount: number
}

export interface BudgetPeriodRecord {
  id: number
  budgetId: number
  budgetName: string
  month: string
  currency: string
  createdAt: string
  targets: BudgetTargetRecord[]
}

interface TransactionRow {
  id: number
  tx_date: string
  description: string
  amount: number
  amount_original: number | null
  amount_home: number | null
  currency: string | null
  fx_rate_used: number | null
  account_name: string | null
  account_currency: string | null
  category_name: string | null
  category_kind: string | null
}

interface FxRateRow {
  base_currency: string
  quote_currency: string
  rate_date: string
  rate: number
  provider: string
}

interface BpiWorkingRow {
  tx_date: string
  counterpartyParts: string[]
  descriptionParts: string[]
  amount: number
}

interface PdfParseResult {
  text?: string
}

interface ImportBatchSummaryRow {
  id: number
  source_type: string
  source_filename: string | null
  account_id: number | null
  account_name: string | null
  parser_profile: string | null
  status: string
  total_rows: number
  inserted_rows: number
  parse_notes: string | null
  created_at: string
  parsed_count: number | null
  accepted_count: number | null
  rejected_count: number | null
  duplicate_count: number | null
  needs_review_count: number | null
}

interface ImportRowDbRecord {
  id: number
  batch_id: number
  row_no: number
  raw_text: string
  parsed_tx_date: string | null
  posted_date: string | null
  parsed_description: string | null
  merchant_candidate: string | null
  reference_text: string | null
  parsed_amount: number | null
  confidence: number
  parse_notes: string | null
  status: string
  error: string | null
  transaction_id: number | null
  created_at: string
}

interface CategorizationRuleRow {
  id: number
  priority: number
  match_type: string
  pattern: string
  category_id: number
  category_name: string | null
  account_id: number | null
  account_name: string | null
  active: number
  created_at: string
}

interface BudgetPeriodRow {
  id: number
  budget_id: number
  budget_name: string
  month: string
  currency: string
  created_at: string
}

interface BudgetTargetRow {
  id: number
  category_id: number
  category_name: string
  target_amount: number
  actual_amount: number | null
}

type PdfParseFn = (buffer: Buffer) => Promise<PdfParseResult>

const IMPORT_ACCEPTANCE_CONFIDENCE = 0.75

export class ExpensesService {
  private readonly dbPath: string
  private readonly schemaPath: string
  private readonly importsDir: string
  private readonly fxRateCache = new Map<string, number>()

  constructor(private readonly rootDir: string) {
    this.dbPath = path.join(rootDir, 'money_dashboard.db')
    this.schemaPath = path.join(rootDir, 'expenses', 'schema.sql')
    this.importsDir = path.join(rootDir, 'imports', 'raw', 'bank', 'latest')
  }

  getOverview(): { income: number; expenses: number; net: number; txCount: number } {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const row = db
        .prepare(
          `
            SELECT
              COALESCE(SUM(
                CASE
                  WHEN COALESCE(t.amount_home, t.amount) > 0
                    AND COALESCE(c.kind, 'expense') != 'transfer'
                  THEN COALESCE(t.amount_home, t.amount)
                END
              ), 0) AS income,
              COALESCE(SUM(
                CASE
                  WHEN COALESCE(t.amount_home, t.amount) < 0
                    AND COALESCE(c.kind, 'expense') != 'transfer'
                  THEN COALESCE(t.amount_home, t.amount)
                END
              ), 0) AS expenses,
              COUNT(*) AS tx_count
            FROM exp_transactions AS t
            LEFT JOIN exp_categories AS c ON c.id = t.category_id
            `
        )
        .get() as OverviewRow | undefined

      const income = Number(row?.income ?? 0)
      const expenses = Number(row?.expenses ?? 0)

      return {
        income,
        expenses,
        net: income + expenses,
        txCount: Number(row?.tx_count ?? 0),
      }
    })
  }

  getMonthlyAnalyticsSummary(limit = 12): MonthlyAnalyticsSummary[] {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `
          SELECT
            substr(t.tx_date, 1, 7) AS month,
            COALESCE(SUM(
              CASE
                WHEN COALESCE(c.kind, 'expense') != 'transfer'
                  AND COALESCE(t.amount_home, t.amount) > 0
                THEN COALESCE(t.amount_home, t.amount)
                ELSE 0
              END
            ), 0) AS income,
            ABS(COALESCE(SUM(
              CASE
                WHEN COALESCE(c.kind, 'expense') != 'transfer'
                  AND COALESCE(t.amount_home, t.amount) < 0
                THEN COALESCE(t.amount_home, t.amount)
                ELSE 0
              END
            ), 0)) AS expenses,
            COUNT(*) AS transaction_count
          FROM exp_transactions AS t
          LEFT JOIN exp_categories AS c ON c.id = t.category_id
          GROUP BY substr(t.tx_date, 1, 7)
          ORDER BY month DESC
          LIMIT ?
          `
        )
        .all(limit) as Array<{
        month: string
        income: number | null
        expenses: number | null
        transaction_count: number | null
      }>

      return rows.map((row) => ({
        month: row.month,
        income: Number(row.income || 0),
        expenses: Number(row.expenses || 0),
        net: Number(row.income || 0) - Number(row.expenses || 0),
        transactionCount: Number(row.transaction_count || 0),
      }))
    })
  }

  getCategoryBreakdown(month?: string, limit = 8): CategoryBreakdownItem[] {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `
          SELECT
            COALESCE(c.name, 'Uncategorized') AS category_name,
            ABS(SUM(COALESCE(t.amount_home, t.amount))) AS total,
            COUNT(*) AS transaction_count
          FROM exp_transactions AS t
          LEFT JOIN exp_categories AS c ON c.id = t.category_id
          WHERE COALESCE(c.kind, 'expense') = 'expense'
            AND COALESCE(t.amount_home, t.amount) < 0
            AND (? IS NULL OR substr(t.tx_date, 1, 7) = ?)
          GROUP BY COALESCE(c.name, 'Uncategorized')
          ORDER BY total DESC, category_name ASC
          LIMIT ?
          `
        )
        .all(month || null, month || null, limit) as Array<{
        category_name: string
        total: number | null
        transaction_count: number | null
      }>

      const grandTotal = rows.reduce((sum, row) => sum + Number(row.total || 0), 0)

      return rows.map((row) => ({
        categoryName: row.category_name,
        total: Number(row.total || 0),
        percentage: grandTotal > 0 ? (Number(row.total || 0) / grandTotal) * 100 : 0,
        transactionCount: Number(row.transaction_count || 0),
      }))
    })
  }

  getCashFlow(limit = 12): CashFlowPoint[] {
    return this.getMonthlyAnalyticsSummary(limit).map((row) => ({
      month: row.month,
      income: row.income,
      expenses: row.expenses,
      net: row.net,
    }))
  }

  getMerchantLeaderboard(month?: string, limit = 8): MerchantLeaderboardItem[] {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `
          SELECT
            m.id AS merchant_id,
            COALESCE(m.name, t.description) AS merchant_name,
            ABS(SUM(COALESCE(t.amount_home, t.amount))) AS total,
            COUNT(*) AS transaction_count,
            MAX(t.tx_date) AS last_transaction_date
          FROM exp_transactions AS t
          LEFT JOIN exp_categories AS c ON c.id = t.category_id
          LEFT JOIN exp_merchants AS m ON m.id = t.merchant_id
          WHERE COALESCE(c.kind, 'expense') = 'expense'
            AND COALESCE(t.amount_home, t.amount) < 0
            AND (? IS NULL OR substr(t.tx_date, 1, 7) = ?)
          GROUP BY m.id, COALESCE(m.name, t.description)
          ORDER BY total DESC, merchant_name ASC
          LIMIT ?
          `
        )
        .all(month || null, month || null, limit) as Array<{
        merchant_id: number | null
        merchant_name: string | null
        total: number | null
        transaction_count: number | null
        last_transaction_date: string | null
      }>

      return rows.map((row) => ({
        merchantId: row.merchant_id,
        merchantName: row.merchant_name || 'Unknown merchant',
        total: Number(row.total || 0),
        transactionCount: Number(row.transaction_count || 0),
        lastTransactionDate: row.last_transaction_date,
      }))
    })
  }

  getSpendingPaceModel(month: string | null): LineChartModel {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const resolvedMonth = month || this.getMonthlyAnalyticsSummary(1)[0]?.month || null
      if (!resolvedMonth) {
        return buildSpendingPaceChart([], null)
      }

      const comparisonMonth = this.getPreviousMonthKey(resolvedMonth)
      const rows = db
        .prepare(
          `
          SELECT
            t.id,
            t.tx_date,
            t.description,
            t.amount,
            t.amount_original,
            t.amount_home,
            t.currency,
            t.fx_rate_used,
            a.name AS account_name,
            a.currency AS account_currency,
            c.name AS category_name,
            COALESCE(c.kind, 'expense') AS category_kind
          FROM exp_transactions AS t
          LEFT JOIN exp_accounts AS a ON a.id = t.account_id
          LEFT JOIN exp_categories AS c ON c.id = t.category_id
          WHERE substr(t.tx_date, 1, 7) = ?
             OR (? IS NOT NULL AND substr(t.tx_date, 1, 7) = ?)
          ORDER BY t.tx_date ASC, t.id ASC
          `
        )
        .all(resolvedMonth, comparisonMonth, comparisonMonth) as TransactionRecord[]

      return buildSpendingPaceChart(rows, resolvedMonth)
    })
  }

  listTransactions(limit: number, month?: string | null): TransactionRow[] {
    this.ensureSchema()

    return this.withDatabase(
      (db) =>
        db
          .prepare(
            `
          SELECT
            t.id,
            t.tx_date,
            t.description,
            t.amount,
            t.amount_original,
            t.amount_home,
            t.currency,
            t.fx_rate_used,
            a.name AS account_name,
            a.currency AS account_currency,
            c.name AS category_name,
            COALESCE(c.kind, 'expense') AS category_kind
          FROM exp_transactions AS t
          LEFT JOIN exp_accounts AS a ON a.id = t.account_id
          LEFT JOIN exp_categories AS c ON c.id = t.category_id
          WHERE (? IS NULL OR substr(t.tx_date, 1, 7) = ?)
          ORDER BY t.tx_date DESC, t.id DESC
          LIMIT ?
          `
          )
          .all(month || null, month || null, limit) as TransactionRow[]
    )
  }

  listFxRates(limit = 20): FxRateRow[] {
    this.ensureSchema()

    return this.withDatabase(
      (db) =>
        db
          .prepare(
            `
          SELECT base_currency, quote_currency, rate_date, rate, provider
          FROM exp_fx_rates
          ORDER BY rate_date DESC, id DESC
          LIMIT ?
          `
          )
          .all(limit) as FxRateRow[]
    )
  }

  listImportBatches(limit = 20): ImportBatchSummary[] {
    this.ensureSchema()

    return this.withDatabase((db) => this.listImportBatchesWithDb(db, limit))
  }

  getImportBatch(batchId: number): ImportBatchDetail {
    this.ensureSchema()

    return this.withDatabase((db) => this.getImportBatchWithDb(db, batchId))
  }

  async acceptImportRow(rowId: number): Promise<ImportRowActionResult> {
    this.ensureSchema()

    return this.withDatabase(async (db) => {
      const row = this.getImportRowWithContext(db, rowId)
      if (!row) {
        throw new Error(`import row ${rowId} not found`)
      }

      if (row.transaction_id != null) {
        this.refreshImportBatchMetrics(db, row.batch_id)
        return {
          row: this.getImportRowOrThrow(db, rowId),
          batch: this.getImportBatchWithDb(db, row.batch_id),
        }
      }

      if (!row.account_id) {
        throw new Error(`import row ${rowId} is missing an account`)
      }
      const accountId = row.account_id
      if (!row.parsed_tx_date || !row.parsed_description || row.parsed_amount == null) {
        throw new Error(
          `import row ${rowId} cannot be accepted without date, description, and amount`
        )
      }

      const account = db.prepare('SELECT currency FROM exp_accounts WHERE id = ?').get(accountId) as
        | { currency: string | null }
        | undefined
      const accountCurrency = (account?.currency || 'PHP').toUpperCase()
      const fxRate = await this.getFxRate(
        db,
        accountCurrency,
        'PHP',
        row.posted_date || row.parsed_tx_date
      )

      const runAccept = db.transaction(() => {
        const categoryId = this.pickCategory(
          db,
          row.parsed_description || '',
          Number(row.parsed_amount),
          accountId
        )
        const amountOriginal = Number(row.parsed_amount)
        const amountHome = amountOriginal * fxRate
        const parsedEntry: ParsedExpenseTransaction = {
          tx_date: row.parsed_tx_date || '',
          description: row.parsed_description || '',
          amount: amountOriginal,
          confidence: Number(row.confidence || 0),
        }
        const merchantId = this.resolveMerchant(db, row.parsed_description)
        const sourceHash = this.buildManualAcceptSourceHash(
          accountId,
          parsedEntry,
          row.raw_text,
          row.id
        )
        const insertResult = db
          .prepare(
            `
            INSERT INTO exp_transactions(
              account_id,
              tx_date,
              posted_date,
              description,
              merchant_id,
              amount,
              currency,
              amount_original,
              amount_home,
              fx_rate_used,
              fx_date,
              category_id,
              import_batch_id,
              source_hash
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            accountId,
            row.parsed_tx_date,
            row.posted_date || row.parsed_tx_date,
            row.parsed_description,
            merchantId,
            amountOriginal,
            accountCurrency,
            amountOriginal,
            amountHome,
            fxRate,
            row.parsed_tx_date,
            categoryId,
            row.batch_id,
            sourceHash
          )

        db.prepare(
          `
          UPDATE exp_import_rows_raw
          SET status = 'accepted', transaction_id = ?, error = NULL
          WHERE id = ?
          `
        ).run(Number(insertResult.lastInsertRowid), row.id)

        this.refreshImportBatchMetrics(db, row.batch_id)
      })

      runAccept()

      return {
        row: this.getImportRowOrThrow(db, rowId),
        batch: this.getImportBatchWithDb(db, row.batch_id),
      }
    })
  }

  rejectImportRow(rowId: number): ImportRowActionResult {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const row = this.getImportRowWithContext(db, rowId)
      if (!row) {
        throw new Error(`import row ${rowId} not found`)
      }

      const runReject = db.transaction(() => {
        if (row.transaction_id != null) {
          db.prepare('DELETE FROM exp_transactions WHERE id = ?').run(row.transaction_id)
        }

        db.prepare(
          `
          UPDATE exp_import_rows_raw
          SET status = 'rejected', transaction_id = NULL
          WHERE id = ?
          `
        ).run(row.id)

        this.refreshImportBatchMetrics(db, row.batch_id)
      })

      runReject()

      return {
        row: this.getImportRowOrThrow(db, rowId),
        batch: this.getImportBatchWithDb(db, row.batch_id),
      }
    })
  }

  listCategorizationRules(): CategorizationRuleRecord[] {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `
          SELECT
            r.id,
            r.priority,
            r.match_type,
            r.pattern,
            r.category_id,
            c.name AS category_name,
            r.account_id,
            a.name AS account_name,
            r.active,
            r.created_at
          FROM exp_categorization_rules AS r
          INNER JOIN exp_categories AS c ON c.id = r.category_id
          LEFT JOIN exp_accounts AS a ON a.id = r.account_id
          WHERE r.active = 1
          ORDER BY r.priority ASC, r.id ASC
          `
        )
        .all() as CategorizationRuleRow[]

      return rows.map((row) => this.mapCategorizationRuleRecord(row))
    })
  }

  createCategorizationRuleFromTransaction(input: {
    transactionId: number
    categoryId: number
    accountScoped?: boolean
    matchType?: string
    priority?: number
    pattern?: string
  }): CategorizationRuleRecord {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const transaction = db
        .prepare(
          `
          SELECT id, account_id, description
          FROM exp_transactions
          WHERE id = ?
          LIMIT 1
          `
        )
        .get(input.transactionId) as
        | { id: number; account_id: number; description: string | null }
        | undefined

      if (!transaction) {
        throw new Error(`transaction ${input.transactionId} not found`)
      }

      const category = db
        .prepare('SELECT id FROM exp_categories WHERE id = ? LIMIT 1')
        .get(input.categoryId) as { id: number } | undefined
      if (!category) {
        throw new Error(`category ${input.categoryId} not found`)
      }

      const matchType = ['contains', 'exact', 'regex'].includes(input.matchType || '')
        ? String(input.matchType)
        : 'contains'
      const pattern = (input.pattern || transaction.description || '').trim()
      if (!pattern) {
        throw new Error('rule pattern cannot be empty')
      }

      const accountId = input.accountScoped === false ? null : transaction.account_id
      const priority = Number.isFinite(input.priority) ? Number(input.priority) : 100

      const runCreate = db.transaction(() => {
        db.prepare('UPDATE exp_transactions SET category_id = ? WHERE id = ?').run(
          input.categoryId,
          input.transactionId
        )

        const insertResult = db
          .prepare(
            `
            INSERT INTO exp_categorization_rules(
              priority,
              match_type,
              pattern,
              category_id,
              account_id,
              active
            )
            VALUES(?, ?, ?, ?, ?, 1)
            `
          )
          .run(priority, matchType, pattern, input.categoryId, accountId)

        return Number(insertResult.lastInsertRowid)
      })

      const ruleId = runCreate()
      return this.getCategorizationRuleOrThrow(db, ruleId)
    })
  }

  disableCategorizationRule(ruleId: number): CategorizationRuleRecord {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const existingRule = this.getCategorizationRuleOrThrow(db, ruleId)

      db.prepare(
        `
        UPDATE exp_categorization_rules
        SET active = 0
        WHERE id = ?
        `
      ).run(ruleId)

      return {
        ...existingRule,
        active: false,
      }
    })
  }

  listBudgetPeriods(): BudgetPeriodRecord[] {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const rows = db
        .prepare(
          `
          SELECT
            p.id,
            p.budget_id,
            b.name AS budget_name,
            p.month,
            b.currency,
            p.created_at
          FROM exp_budget_periods AS p
          INNER JOIN exp_budgets AS b ON b.id = p.budget_id
          ORDER BY p.month DESC, p.id DESC
          `
        )
        .all() as BudgetPeriodRow[]

      return rows.map((row) => this.getBudgetPeriodWithRow(db, row))
    })
  }

  createBudgetPeriod(input: {
    month: string
    budgetName?: string
    currency?: string
  }): BudgetPeriodRecord {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const budgetId = this.getOrCreateBudget(
        db,
        input.budgetName || 'Default Budget',
        input.currency || 'PHP'
      )
      const insertResult = db
        .prepare(
          `
          INSERT INTO exp_budget_periods(budget_id, month)
          VALUES(?, ?)
          ON CONFLICT(budget_id, month) DO UPDATE SET month = excluded.month
          RETURNING id
          `
        )
        .get(budgetId, input.month) as { id: number } | undefined

      if (!insertResult) {
        throw new Error('failed to create budget period')
      }

      return this.getBudgetPeriod(insertResult.id)
    })
  }

  getBudgetPeriod(periodId: number): BudgetPeriodRecord {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const row = db
        .prepare(
          `
          SELECT
            p.id,
            p.budget_id,
            b.name AS budget_name,
            p.month,
            b.currency,
            p.created_at
          FROM exp_budget_periods AS p
          INNER JOIN exp_budgets AS b ON b.id = p.budget_id
          WHERE p.id = ?
          LIMIT 1
          `
        )
        .get(periodId) as BudgetPeriodRow | undefined

      if (!row) {
        throw new Error(`budget period ${periodId} not found`)
      }

      return this.getBudgetPeriodWithRow(db, row)
    })
  }

  upsertBudgetTarget(
    periodId: number,
    categoryId: number,
    targetAmount: number
  ): BudgetPeriodRecord {
    this.ensureSchema()

    return this.withDatabase((db) => {
      db.prepare(
        `
        INSERT INTO exp_budget_targets(period_id, category_id, target_amount)
        VALUES(?, ?, ?)
        ON CONFLICT(period_id, category_id)
        DO UPDATE SET target_amount = excluded.target_amount
        `
      ).run(periodId, categoryId, targetAmount)

      return this.getBudgetPeriod(periodId)
    })
  }

  deleteBudgetTarget(targetId: number): BudgetPeriodRecord {
    this.ensureSchema()

    return this.withDatabase((db) => {
      const target = db
        .prepare('SELECT period_id FROM exp_budget_targets WHERE id = ? LIMIT 1')
        .get(targetId) as { period_id: number } | undefined
      if (!target) {
        throw new Error(`budget target ${targetId} not found`)
      }

      db.prepare('DELETE FROM exp_budget_targets WHERE id = ?').run(targetId)
      return this.getBudgetPeriod(target.period_id)
    })
  }

  async upsertFxRate(
    baseCurrency: string,
    quoteCurrency: string,
    rate: number,
    rateDate?: string
  ): Promise<{ ok: boolean }> {
    this.ensureSchema()

    const base = (baseCurrency || 'USD').toUpperCase().trim()
    const quote = (quoteCurrency || 'PHP').toUpperCase().trim()
    const resolvedRateDate = (rateDate || this.today()).trim()

    if (rate <= 0) {
      throw new Error('rate must be greater than zero')
    }

    this.withDatabase((db) => {
      db.prepare(
        `
        INSERT INTO exp_fx_rates(base_currency, quote_currency, rate_date, rate, provider)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(base_currency, quote_currency, rate_date)
        DO UPDATE SET rate = excluded.rate, provider = excluded.provider
        `
      ).run(base, quote, resolvedRateDate, rate, 'manual')

      db.prepare(
        `
        UPDATE exp_transactions
        SET amount_home = amount_original * ?, fx_rate_used = ?, fx_date = ?
        WHERE currency = ?
        `
      ).run(rate, rate, resolvedRateDate, base)
    })

    this.fxRateCache.set(this.fxCacheKey(base, quote, resolvedRateDate), rate)

    return { ok: true }
  }

  async backfillFx(): Promise<{ ok: boolean; updated: number }> {
    this.ensureSchema()

    return this.withDatabase(async (db) => {
      const rows = db
        .prepare(
          `
          SELECT id, tx_date, currency, amount_original
          FROM exp_transactions
          WHERE currency = 'USD'
          `
        )
        .all() as Array<{
        id: number
        tx_date: string
        currency: string
        amount_original: number | null
      }>

      let updated = 0
      const updateStatement = db.prepare(
        `
        UPDATE exp_transactions
        SET amount_home = ?, fx_rate_used = ?, fx_date = ?
        WHERE id = ?
        `
      )

      for (const row of rows) {
        const rate = await this.getFxRate(db, row.currency, 'PHP', row.tx_date)
        const amountHome = Number(row.amount_original ?? 0) * rate
        updateStatement.run(amountHome, rate, row.tx_date, row.id)
        updated += 1
      }

      return { ok: true, updated }
    })
  }

  async importPdfStatement(
    accountName: string,
    filename: string,
    content: Buffer
  ): Promise<{ ok: boolean; batchId: number; parsedRows: number; insertedTransactions: number }> {
    this.ensureSchema()

    const pdfPath = this.saveUploadBytes(filename, content, this.importsDir)
    const text = await this.extractPdfText(pdfPath)
    const parsedDocument = this.parsePdfDocument(text.split(/\r?\n/).filter((line) => line.trim()))
    const { parserProfile, rows: parsedRows } = parsedDocument

    return this.withDatabase(async (db) => {
      const accountId = this.getOrCreateAccount(db, accountName)
      const accountRow = db
        .prepare('SELECT currency FROM exp_accounts WHERE id = ?')
        .get(accountId) as { currency: string | null } | undefined
      const accountCurrency = (accountRow?.currency || 'PHP').toUpperCase()

      const batchResult = db
        .prepare(
          `
          INSERT INTO exp_import_batches(
            source_type,
            source_filename,
            account_id,
            parser_profile,
            status,
            total_rows
          )
          VALUES('pdf', ?, ?, ?, ?, 0)
          `
        )
        .run(path.basename(pdfPath), accountId, parserProfile, 'parsed')
      const batchId = Number(batchResult.lastInsertRowid)

      let parsedCount = 0
      let insertedCount = 0
      const rawRowStatement = db.prepare(
        `
        INSERT INTO exp_import_rows_raw(
          batch_id,
          row_no,
          raw_text,
          parsed_tx_date,
          posted_date,
          parsed_description,
          merchant_candidate,
          reference_text,
          parsed_amount,
          confidence,
          parse_notes,
          status,
          transaction_id
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      const insertTransactionStatement = db.prepare(
        `
        INSERT INTO exp_transactions(
          account_id,
          tx_date,
          posted_date,
          description,
          merchant_id,
          amount,
          currency,
          amount_original,
          amount_home,
          fx_rate_used,
          fx_date,
          category_id,
          import_batch_id,
          source_hash
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )

      for (const [index, parsedRow] of parsedRows.entries()) {
        parsedCount += 1
        const normalizedRow = this.normalizeParsedImportRow(parsedRow)
        const rawText = this.buildRawImportText(normalizedRow)
        const referenceText = normalizedRow.referenceText ?? normalizedRow.description
        const merchantCandidate =
          normalizedRow.merchantCandidate ??
          this.extractMerchantCandidate(normalizedRow.description)
        const reviewIssues = this.buildReviewIssues(normalizedRow)
        const parseNotes = [
          ...reviewIssues,
          ...(normalizedRow.parseNotes ? [normalizedRow.parseNotes] : []),
        ]
        let status: 'accepted' | 'duplicate' | 'needs_review' = 'needs_review'
        let transactionId: number | null = null

        if (
          normalizedRow.txDate &&
          normalizedRow.description &&
          normalizedRow.amount != null &&
          reviewIssues.length === 0
        ) {
          const transactionCandidate: ParsedExpenseTransaction = {
            tx_date: normalizedRow.txDate,
            description: normalizedRow.description,
            amount: normalizedRow.amount,
            confidence: normalizedRow.confidence,
          }

          if (this.transactionExists(db, accountId, transactionCandidate, rawText)) {
            status = 'duplicate'
          } else {
            const categoryId = this.pickCategory(
              db,
              transactionCandidate.description,
              transactionCandidate.amount,
              accountId
            )
            const merchantId = this.resolveMerchant(db, transactionCandidate.description)
            const fxRate = await this.getFxRate(
              db,
              accountCurrency,
              'PHP',
              transactionCandidate.tx_date
            )
            const amountOriginal = Number(transactionCandidate.amount)
            const amountHome = amountOriginal * fxRate

            try {
              const insertResult = insertTransactionStatement.run(
                accountId,
                transactionCandidate.tx_date,
                normalizedRow.postedDate ?? transactionCandidate.tx_date,
                transactionCandidate.description,
                merchantId,
                amountOriginal,
                accountCurrency,
                amountOriginal,
                amountHome,
                fxRate,
                transactionCandidate.tx_date,
                categoryId,
                batchId,
                this.buildSourceHash(accountId, transactionCandidate, rawText)
              )
              insertedCount += 1
              status = 'accepted'
              transactionId = Number(insertResult.lastInsertRowid)
            } catch (error) {
              if (
                error instanceof Database.SqliteError &&
                error.code === 'SQLITE_CONSTRAINT_UNIQUE'
              ) {
                status = 'duplicate'
              } else {
                throw error
              }
            }
          }
        }

        rawRowStatement.run(
          batchId,
          index + 1,
          rawText,
          normalizedRow.txDate,
          normalizedRow.postedDate,
          normalizedRow.description,
          merchantCandidate,
          referenceText,
          normalizedRow.amount,
          normalizedRow.confidence,
          parseNotes.join('; ') || null,
          status,
          transactionId
        )
      }

      this.refreshImportBatchMetrics(db, batchId)

      return {
        ok: true,
        batchId,
        parsedRows: parsedCount,
        insertedTransactions: insertedCount,
      }
    })
  }

  ensureSchema(): void {
    if (!this.fileExists(this.schemaPath)) {
      throw new Error('expenses/schema.sql not found')
    }

    this.withDatabase((db) => {
      db.exec(readFileSync(this.schemaPath, 'utf8'))

      const existingColumns = new Set(
        (db.prepare('PRAGMA table_info(exp_transactions)').all() as TableInfoRow[]).map(
          (row) => row.name
        )
      )
      const merchantColumns = new Set(
        (db.prepare('PRAGMA table_info(exp_merchants)').all() as TableInfoRow[]).map(
          (row) => row.name
        )
      )
      const batchColumns = new Set(
        (db.prepare('PRAGMA table_info(exp_import_batches)').all() as TableInfoRow[]).map(
          (row) => row.name
        )
      )
      const rawImportColumns = new Set(
        (db.prepare('PRAGMA table_info(exp_import_rows_raw)').all() as TableInfoRow[]).map(
          (row) => row.name
        )
      )

      if (!existingColumns.has('amount_original')) {
        db.exec('ALTER TABLE exp_transactions ADD COLUMN amount_original REAL')
      }
      if (!existingColumns.has('posted_date')) {
        db.exec('ALTER TABLE exp_transactions ADD COLUMN posted_date TEXT')
      }
      if (!existingColumns.has('merchant_id')) {
        db.exec(
          'ALTER TABLE exp_transactions ADD COLUMN merchant_id INTEGER REFERENCES exp_merchants(id) ON DELETE SET NULL'
        )
      }
      if (!existingColumns.has('amount_home')) {
        db.exec('ALTER TABLE exp_transactions ADD COLUMN amount_home REAL')
      }
      if (!existingColumns.has('fx_rate_used')) {
        db.exec('ALTER TABLE exp_transactions ADD COLUMN fx_rate_used REAL')
      }
      if (!existingColumns.has('fx_date')) {
        db.exec('ALTER TABLE exp_transactions ADD COLUMN fx_date TEXT')
      }
      if (!merchantColumns.has('normalized_name')) {
        db.exec('ALTER TABLE exp_merchants ADD COLUMN normalized_name TEXT')
      }
      if (!batchColumns.has('parser_profile')) {
        db.exec('ALTER TABLE exp_import_batches ADD COLUMN parser_profile TEXT')
      }
      if (!rawImportColumns.has('posted_date')) {
        db.exec('ALTER TABLE exp_import_rows_raw ADD COLUMN posted_date TEXT')
      }
      if (!rawImportColumns.has('merchant_candidate')) {
        db.exec('ALTER TABLE exp_import_rows_raw ADD COLUMN merchant_candidate TEXT')
      }
      if (!rawImportColumns.has('reference_text')) {
        db.exec('ALTER TABLE exp_import_rows_raw ADD COLUMN reference_text TEXT')
      }
      if (!rawImportColumns.has('parse_notes')) {
        db.exec('ALTER TABLE exp_import_rows_raw ADD COLUMN parse_notes TEXT')
      }
      if (!rawImportColumns.has('transaction_id')) {
        db.exec(
          'ALTER TABLE exp_import_rows_raw ADD COLUMN transaction_id INTEGER REFERENCES exp_transactions(id) ON DELETE SET NULL'
        )
      }

      db.exec('UPDATE exp_transactions SET amount_original = COALESCE(amount_original, amount)')
      db.exec('UPDATE exp_transactions SET amount_home = COALESCE(amount_home, amount)')
      db.exec(
        `
        UPDATE exp_transactions
        SET fx_rate_used = COALESCE(
          fx_rate_used,
          CASE WHEN currency = 'PHP' THEN 1.0 ELSE NULL END
        )
        `
      )
      db.exec('UPDATE exp_transactions SET fx_date = COALESCE(fx_date, tx_date)')

      db.prepare(
        `
        INSERT OR IGNORE INTO exp_fx_rates(
          base_currency,
          quote_currency,
          rate_date,
          rate,
          provider
        )
        VALUES('PHP', 'PHP', date('now'), 1.0, 'system')
        `
      ).run()

      db.prepare(
        `
        INSERT OR IGNORE INTO exp_fx_rates(
          base_currency,
          quote_currency,
          rate_date,
          rate,
          provider
        )
        VALUES('USD', 'PHP', date('now'), 58.0, 'bootstrap')
        `
      ).run()

      this.runExpenseDataMigrations(db)
    })
  }

  parsePdfLines(lines: string[]): ParsedExpenseTransaction[] {
    return this.parsePdfDocument(lines).rows.map((row) => ({
      tx_date: row.txDate || '',
      description: row.description || '',
      amount: Number(row.amount || 0),
      confidence: row.confidence,
    }))
  }

  private parsePdfDocument(lines: string[]): {
    parserProfile: ParserProfile
    rows: ParsedImportRow[]
  } {
    const parserProfile = this.detectParserProfile(lines)

    return {
      parserProfile,
      rows: this.parsePdfLinesForProfile(lines, parserProfile).map((row) =>
        this.toParsedImportRow(row, parserProfile)
      ),
    }
  }

  private detectParserProfile(lines: string[]): ParserProfile {
    if (this.looksLikeBpiAccountActivities(lines)) {
      return 'bpi_account_activities'
    }

    if (this.looksLikeRevolutStatement(lines)) {
      return 'revolut_usd_statement'
    }

    if (this.looksLikeCompactRevolutStatement(lines)) {
      return 'revolut_compact_statement'
    }

    return 'generic_numeric'
  }

  private parsePdfLinesForProfile(
    lines: string[],
    parserProfile: ParserProfile
  ): ParsedExpenseTransaction[] {
    if (parserProfile === 'bpi_account_activities') {
      return this.parseBpiAccountActivities(lines)
    }

    if (parserProfile === 'revolut_usd_statement') {
      return this.parseRevolutStatement(lines)
    }

    if (parserProfile === 'revolut_compact_statement') {
      return this.parseCompactRevolutStatement(lines)
    }

    return this.parseGenericPdfLines(lines)
  }

  cleanupExistingTransactionDescriptions(db: Database.Database): void {
    const rows = db
      .prepare(
        `
        SELECT t.id, t.description, a.name AS account_name
        FROM exp_transactions AS t
        LEFT JOIN exp_accounts AS a ON a.id = t.account_id
        `
      )
      .all() as Array<{ id: number; description: string | null; account_name: string | null }>

    const updateStatement = db.prepare('UPDATE exp_transactions SET description = ? WHERE id = ?')

    for (const row of rows) {
      const cleaned = this.normalizeLocalBankDescription(
        row.description || '',
        '',
        row.account_name || ''
      )

      if (cleaned && cleaned !== row.description) {
        updateStatement.run(cleaned, row.id)
      }
    }
  }

  normalizeLocalBankDescription(description: string, counterparty = '', accountName = ''): string {
    const normalizedDescription = this.dedupeRepeatedPhrase(description)
    const normalizedCounterparty = this.dedupeRepeatedPhrase(counterparty)
    const combined = [normalizedCounterparty, normalizedDescription]
      .filter(Boolean)
      .join(' ')
      .trim()
    const upperCombined = combined.toUpperCase()
    const upperDescription = normalizedDescription.toUpperCase()
    const upperAccountName = accountName.toUpperCase()

    if (!this.looksLikeLocalBankImport(upperCombined, upperDescription, upperAccountName)) {
      return normalizedDescription
    }

    const directReplacements: Array<[string, string]> = [
      ['INTEREST WITHHELD', 'Interest withheld'],
      ['INTEREST PAY SYS-GEN', 'Interest payment'],
      ['PMMF PLACEMENT', 'PMMF placement'],
      ['W/D P BDO', 'BDO ATM withdrawal'],
      ['CASH WITHDRAWAL', 'ATM withdrawal'],
      ['SOFT HABIT', 'Soft Habit'],
      ['SM SUPERMA', 'SM Supermarket'],
      ['SM STORE', 'SM Store'],
      ['STARBUCKS', 'Starbucks'],
      ['SHOPEE', 'Shopee'],
      ['LAZADA', 'Lazada'],
      ['GRAB', 'Grab'],
      ['DECATHLON', 'Decathlon'],
      ['UNIQLO', 'Uniqlo'],
      ['MY HEALTH', 'My Health'],
      ['LUXENT HOT', 'Luxent Hotel'],
      ['METROBANK MAKATI', 'Metrobank Makati'],
      ['H&M', 'H&M'],
    ]

    for (const [needle, replacement] of directReplacements) {
      if (upperCombined.includes(needle)) {
        return replacement
      }
    }

    if (
      upperCombined.includes('SENT VIA INSTAPAY') ||
      upperDescription.startsWith('POB IBFT BN-')
    ) {
      const match = upperCombined.match(/([A-Z]{3}\s+\*{4}\d{4})/)
      if (match) {
        return `InstaPay transfer to ${match[1]}`
      }
      return 'InstaPay transfer'
    }

    let cleaned = upperDescription
    cleaned = cleaned.replace(/^(POS W\/D SV|POS W\/D|W\/D P|SV|POS)\s+/, '')
    cleaned = cleaned.replace(/\b(POS|ATP|MLIC|IBTW|SYS-GEN)\b/g, '')
    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[ -]+|[ -]+$/g, '')
    if (!cleaned) {
      cleaned = upperDescription
    }

    return this.smartTitleCase(cleaned)
  }

  private withDatabase<T>(operation: (db: Database.Database) => T): T
  private withDatabase<T>(operation: (db: Database.Database) => Promise<T>): Promise<T>
  private withDatabase<T>(
    operation: ((db: Database.Database) => T) | ((db: Database.Database) => Promise<T>)
  ): T | Promise<T> {
    const db = new Database(this.dbPath)
    db.pragma('foreign_keys = ON')

    try {
      const result = operation(db)
      if (result instanceof Promise) {
        return result.finally(() => db.close())
      }
      db.close()
      return result
    } catch (error) {
      db.close()
      throw error
    }
  }

  private saveUploadBytes(filename: string, content: Buffer, destination: string): string {
    const safeName = path.basename(filename || 'statement.pdf') || 'statement.pdf'
    mkdirSync(destination, { recursive: true })
    const outputPath = path.join(destination, safeName)
    writeFileSync(outputPath, content)
    return outputPath
  }

  private async extractPdfText(pdfPath: string): Promise<string> {
    try {
      const output = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (output) {
        return output
      }
    } catch {}

    try {
      const pdfParseModule = (await import('pdf-parse')) as unknown as {
        default?: PdfParseFn
      }
      const pdfParse = pdfParseModule.default

      if (!pdfParse) {
        throw new Error('pdf-parse export not available')
      }

      const parsed = await pdfParse(readFileSync(pdfPath))
      const text = (parsed.text || '').trim()
      if (text) {
        return text
      }
    } catch (error) {
      throw new Error(`failed to extract PDF text: ${this.toErrorMessage(error)}`)
    }

    throw new Error('failed to extract PDF text: no extractor produced output')
  }

  private parseGenericPdfLines(lines: string[]): ParsedExpenseTransaction[] {
    const parsedRows: ParsedExpenseTransaction[] = []
    let currentDate: string | null = null
    let currentDescription: string[] = []
    const datePrefix = /^(\w{3}\s+\d{1,2},\s+\d{4})\s+(.+)$/
    const amountPattern = /(-?\s*PHP\s*[\d,]+\.\d{2}|-?\$[\d,]+\.\d{2}|\$[\d,]+\.\d{2})/i

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) {
        continue
      }
      if (
        ['page ', 'available balance', 'account number', 'date counterparty'].some((prefix) =>
          line.toLowerCase().startsWith(prefix)
        )
      ) {
        continue
      }

      const parsedLine = this.parseTransactionLine(line)
      if (parsedLine) {
        parsedRows.push(parsedLine)
        currentDate = null
        currentDescription = []
        continue
      }

      const dateMatch = line.match(datePrefix)
      if (dateMatch) {
        const matchedDate = dateMatch[1]
        const matchedDescription = dateMatch[2]
        if (!matchedDate || !matchedDescription) {
          continue
        }

        currentDate = matchedDate
        currentDescription = [matchedDescription.trim()]
        continue
      }

      if (currentDate && !amountPattern.test(line)) {
        currentDescription.push(line)
        continue
      }

      const amountMatch = line.match(amountPattern)
      if (currentDate && amountMatch?.[1]) {
        const token = amountMatch[1]
        const value = Number(token.replace(/[^0-9.-]/g, '').replace(/,/g, ''))
        let amount = token.trim().startsWith('-') ? -Math.abs(value) : Math.abs(value)
        const leadingDescription = line.slice(0, amountMatch.index).trim()
        const description = [...currentDescription, leadingDescription].filter(Boolean).join(' ')
        const normalizedDescription = description.replace(/\s+/g, ' ').trim()
        const descriptionLower = normalizedDescription.toLowerCase()

        if (
          descriptionLower.includes('pmmf placement') ||
          descriptionLower.includes('investment')
        ) {
          amount = Math.abs(amount)
        } else if (amount > 0 && this.looksLikeOutflow(descriptionLower)) {
          amount = -amount
        }

        parsedRows.push({
          tx_date: this.normalizeMonthDate(currentDate),
          description: normalizedDescription.slice(0, 200) || 'Transaction',
          amount,
          confidence: 0.78,
        })
        currentDate = null
        currentDescription = []
      }
    }

    return parsedRows
  }

  private looksLikeBpiAccountActivities(lines: string[]): boolean {
    return (
      lines.some((line) => line.includes('Account number:')) &&
      lines.some((line) => line.includes('Counterparty'))
    )
  }

  private parseBpiAccountActivities(lines: string[]): ParsedExpenseTransaction[] {
    const rowStart = /^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+(.+?)\s+(-?PHP[\d,]+\.\d{2})$/
    const parsedRows: ParsedExpenseTransaction[] = []
    let currentRow: BpiWorkingRow | null = null

    const flushCurrentRow = () => {
      if (!currentRow) {
        return
      }

      const rawDescription = this.collapseDescriptionParts(currentRow.descriptionParts)
      const rawCounterparty = this.collapseDescriptionParts(currentRow.counterpartyParts)
      const description = this.normalizeLocalBankDescription(rawDescription, rawCounterparty)

      parsedRows.push({
        tx_date: currentRow.tx_date,
        description: description || 'Transaction',
        amount: currentRow.amount,
        confidence: 0.96,
      })
      currentRow = null
    }

    for (const rawLine of lines) {
      const line = rawLine.replace(/\f/g, '').replace(/\s+$/, '')
      const stripped = line.trim()
      if (!stripped || this.isBpiNoiseLine(stripped)) {
        continue
      }

      const match = stripped.match(rowStart)
      if (match) {
        flushCurrentRow()
        const rawDate = match[1]
        const payload = match[2]
        const amountToken = match[3]
        if (!rawDate || !payload || !amountToken) {
          continue
        }
        const [counterpartyPart, descriptionPart] = this.extractBpiRowSegments(payload)

        currentRow = {
          tx_date: this.normalizeMonthDate(rawDate),
          counterpartyParts: counterpartyPart ? [counterpartyPart] : [],
          descriptionParts: descriptionPart ? [descriptionPart] : [],
          amount: this.parsePhpAmount(amountToken),
        }
        continue
      }

      if (currentRow) {
        const [counterpartyPart, descriptionPart] = this.extractBpiRowSegments(stripped)
        if (counterpartyPart) {
          currentRow.counterpartyParts.push(counterpartyPart)
        }
        if (descriptionPart) {
          currentRow.descriptionParts.push(descriptionPart)
        }
      }
    }

    flushCurrentRow()
    return parsedRows
  }

  private looksLikeRevolutStatement(lines: string[]): boolean {
    return (
      lines.some((line) => line.includes('Account transactions from')) &&
      lines.some((line) => line.includes('Revolut Ltd'))
    )
  }

  private looksLikeCompactRevolutStatement(lines: string[]): boolean {
    return lines.some((line) =>
      /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+.+\s+\$[\d,]+\.\d{2}(?:\s+\$[\d,]+\.\d{2})?$/.test(
        line.trim()
      )
    )
  }

  private parseCompactRevolutStatement(lines: string[]): ParsedExpenseTransaction[] {
    const parsedRows: ParsedExpenseTransaction[] = []

    for (const rawLine of lines) {
      const parsedRow = this.parseTransactionLine(rawLine.trim())
      if (parsedRow) {
        parsedRows.push(parsedRow)
      }
    }

    return parsedRows
  }

  private parseRevolutStatement(lines: string[]): ParsedExpenseTransaction[] {
    const parsedRows: ParsedExpenseTransaction[] = []
    let currentHeader: string | null = null
    let inTransactionSection = false

    const flushCurrentRow = () => {
      if (!currentHeader) {
        return
      }

      const parsedRow = this.parseRevolutTransactionHeader(currentHeader)
      if (parsedRow) {
        parsedRows.push(parsedRow)
      }
      currentHeader = null
    }

    for (const rawLine of lines) {
      const line = rawLine.replace(/\f/g, '').replace(/\s+$/, '')
      const stripped = line.trim()
      if (!stripped) {
        continue
      }

      if (stripped.includes('Account transactions from')) {
        inTransactionSection = true
        continue
      }
      if (!inTransactionSection || this.isRevolutNoiseLine(stripped)) {
        continue
      }

      if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+/.test(stripped)) {
        flushCurrentRow()
        currentHeader = stripped
      }
    }

    flushCurrentRow()
    return parsedRows
  }

  private parseRevolutTransactionHeader(line: string): ParsedExpenseTransaction | null {
    const columns = line.trim().split(/\s{2,}/)
    if (columns.length < 4) {
      return null
    }

    const rawDate = columns[0]
    const description = columns[1]
    if (!rawDate || !description) {
      return null
    }
    const moneyColumns = columns.slice(2).filter((column) => /^\$[\d,]+\.\d{2}$/.test(column))
    if (moneyColumns.length < 2) {
      return null
    }

    const amountToken = moneyColumns.at(-2) ?? moneyColumns[0]
    if (!amountToken) {
      return null
    }

    let amount = this.parseUsdAmount(amountToken)
    const normalizedDescription = description.toLowerCase()

    if (normalizedDescription.includes('depositing savings')) {
      amount = -Math.abs(amount)
    } else if (this.looksLikeIncome(normalizedDescription)) {
      amount = Math.abs(amount)
    } else {
      amount = -Math.abs(amount)
    }

    return {
      tx_date: this.normalizeMonthDate(rawDate),
      description: description.trim(),
      amount,
      confidence: 0.96,
    }
  }

  private isBpiNoiseLine(line: string): boolean {
    return [
      'Dear customer,',
      'The transactions are listed below',
      'Account number',
      'Available balance',
      'Date',
      'Counterparty',
      'Description',
      'Amount',
      'Exported date range',
      'Page ',
    ].some((prefix) => line.startsWith(prefix))
  }

  private isRevolutNoiseLine(line: string): boolean {
    return [
      'USD Statement',
      'Generated on ',
      'Revolut Ltd',
      'Date',
      'Report lost or stolen card',
      '+44 ',
      'Get help directly in-app',
      'Scan the QR code',
      '© ',
      'Page ',
    ].some((prefix) => line.startsWith(prefix))
  }

  private extractBpiRowSegments(text: string): [string, string] {
    const segments = text
      .split(/\s{2,}/)
      .map((segment) => segment.trim())
      .filter(Boolean)

    if (segments.length === 0) {
      return ['', '']
    }
    if (segments.length === 1) {
      const onlySegment = segments[0]
      return ['', onlySegment ? onlySegment.replace(/\s+/g, ' ').trim() : '']
    }

    const firstSegment = segments[0]
    const lastSegment = segments.at(-1)
    return [
      firstSegment ? firstSegment.replace(/\s+/g, ' ').trim() : '',
      lastSegment ? lastSegment.replace(/\s+/g, ' ').trim() : '',
    ]
  }

  private collapseDescriptionParts(parts: string[]): string {
    const collapsedParts: string[] = []

    for (const part of parts) {
      const normalized = part.replace(/\s+/g, ' ').trim()
      if (!normalized) {
        continue
      }
      if (
        collapsedParts.length > 0 &&
        (normalized === collapsedParts.at(-1) || collapsedParts.at(-1)?.endsWith(` ${normalized}`))
      ) {
        continue
      }
      collapsedParts.push(normalized)
    }

    return collapsedParts.join(' ').slice(0, 200)
  }

  private parsePhpAmount(token: string): number {
    return Number(token.replace('PHP', '').replaceAll(',', ''))
  }

  private parseUsdAmount(token: string): number {
    return Number(token.replace('$', '').replaceAll(',', ''))
  }

  private runExpenseDataMigrations(db: Database.Database): void {
    if (this.migrationApplied(db, 'description_cleanup_v1')) {
      return
    }

    this.cleanupExistingTransactionDescriptions(db)
    db.prepare(
      `
      INSERT OR REPLACE INTO exp_meta(key, value)
      VALUES(?, ?)
      `
    ).run('description_cleanup_v1', new Date().toISOString())
  }

  private migrationApplied(db: Database.Database, key: string): boolean {
    const row = db.prepare('SELECT 1 FROM exp_meta WHERE key = ? LIMIT 1').get(key)
    return Boolean(row)
  }

  private looksLikeLocalBankImport(
    combined: string,
    description: string,
    accountName: string
  ): boolean {
    if (['BPI', 'BDO'].some((marker) => accountName.includes(marker))) {
      return true
    }

    const patterns = [
      'POS W/D',
      'SENT VIA INSTAPAY',
      'POB IBFT',
      'INTEREST WITHHELD',
      'INTEREST PAY',
      'W/D P BDO',
      'PMMF PLACEMENT',
    ]

    return patterns.some((pattern) => combined.includes(pattern) || description.includes(pattern))
  }

  private dedupeRepeatedPhrase(description: string): string {
    const normalized = (description || '').replace(/\s+/g, ' ').trim()
    if (!normalized) {
      return ''
    }

    const words = normalized.split(' ')
    if (words.length % 2 === 0) {
      const midpoint = words.length / 2
      if (words.slice(0, midpoint).join(' ') === words.slice(midpoint).join(' ')) {
        return words.slice(0, midpoint).join(' ')
      }
    }

    const duplicateMatch = normalized.match(/^(.+?)\s+\1$/)
    if (duplicateMatch?.[1]) {
      return duplicateMatch[1]
    }

    return normalized
  }

  private smartTitleCase(text: string): string {
    const replacements = new Map<string, string>([
      ['Atm', 'ATM'],
      ['Bdo', 'BDO'],
      ['Bpi', 'BPI'],
      ['Pmmf', 'PMMF'],
      ['Sm', 'SM'],
      ['Gxi', 'GXI'],
    ])

    return text
      .split(' ')
      .filter(Boolean)
      .map((token) => {
        if (token.includes('*') || /^\d+$/.test(token)) {
          return token
        }

        const titled = token.toLowerCase().replace(/^./, (letter) => letter.toUpperCase())
        return replacements.get(titled) || titled
      })
      .join(' ')
  }

  private parseTransactionLine(line: string): ParsedExpenseTransaction | null {
    const numericDateMatch = line.match(
      /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.+?)\s+([+-]?\$?\d[\d,]*\.\d{2})(?:\s+(CR|DR))?$/i
    )
    if (numericDateMatch) {
      const rawDate = numericDateMatch[1]
      const description = numericDateMatch[2]
      const amountRaw = numericDateMatch[3]
      const crdr = numericDateMatch[4]
      if (!rawDate || !description || !amountRaw) {
        return null
      }
      let amount = Number(amountRaw.replaceAll(',', '').replace('$', ''))

      if (crdr?.toUpperCase() === 'DR' && amount > 0) {
        amount = -amount
      }
      if (crdr?.toUpperCase() === 'CR' && amount < 0) {
        amount = Math.abs(amount)
      }

      return {
        tx_date: this.normalizeTransactionDate(rawDate),
        description: description.trim(),
        amount,
        confidence: description.length > 3 ? 0.9 : 0.7,
      }
    }

    const revolutMatch = line.match(
      /^(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+?)\s+\$([\d,]+\.\d{2})(?:\s+\$([\d,]+\.\d{2}))?$/
    )
    if (!revolutMatch) {
      return null
    }

    const rawDate = revolutMatch[1]
    const description = revolutMatch[2]
    const amountRaw = revolutMatch[3]
    if (!rawDate || !description || !amountRaw) {
      return null
    }
    let amount = Number(amountRaw.replaceAll(',', ''))
    if (!this.looksLikeIncome(description.toLowerCase())) {
      amount = -amount
    }

    return {
      tx_date: this.normalizeDayMonthDate(rawDate),
      description: description.trim(),
      amount,
      confidence: 0.82,
    }
  }

  private toParsedImportRow(
    row: ParsedExpenseTransaction,
    parserProfile: ParserProfile
  ): ParsedImportRow {
    const description = this.normalizeOptionalText(row.description)
    return {
      txDate: this.normalizeOptionalText(row.tx_date),
      postedDate: this.normalizeOptionalText(row.tx_date),
      description,
      amount: Number.isFinite(row.amount) ? row.amount : null,
      confidence: Number.isFinite(row.confidence) ? row.confidence : 0,
      rawText: `${row.tx_date} ${row.description} ${row.amount}`.trim(),
      merchantCandidate: this.extractMerchantCandidate(description),
      referenceText: description,
      parseNotes:
        parserProfile === 'generic_numeric' && row.confidence >= IMPORT_ACCEPTANCE_CONFIDENCE
          ? 'accepted by generic parser fallback'
          : null,
    }
  }

  private normalizeParsedImportRow(row: ParsedImportRow): ParsedImportRow {
    return {
      txDate: this.normalizeOptionalText(row.txDate),
      postedDate: this.normalizeOptionalText(row.postedDate ?? row.txDate),
      description: this.normalizeOptionalText(row.description),
      amount: typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null,
      confidence: Number.isFinite(row.confidence) ? row.confidence : 0,
      rawText: this.normalizeOptionalText(row.rawText) || '',
      merchantCandidate: this.normalizeOptionalText(row.merchantCandidate),
      referenceText: this.normalizeOptionalText(row.referenceText),
      parseNotes: this.normalizeOptionalText(row.parseNotes),
    }
  }

  private buildRawImportText(row: ParsedImportRow): string {
    const fallback = [row.txDate, row.description, row.amount != null ? String(row.amount) : null]
      .filter(Boolean)
      .join(' ')
      .trim()

    return row.rawText || fallback || 'Unparsed import row'
  }

  private buildReviewIssues(row: ParsedImportRow): string[] {
    const notes = new Set<string>()

    if (!row.txDate) {
      notes.add('missing transaction date')
    }
    if (!row.description) {
      notes.add('missing description')
    }
    if (row.amount == null) {
      notes.add('missing amount')
    }
    if (row.confidence < IMPORT_ACCEPTANCE_CONFIDENCE) {
      notes.add(`confidence ${row.confidence.toFixed(2)} below import threshold`)
    }

    return [...notes]
  }

  private listImportBatchesWithDb(db: Database.Database, limit: number): ImportBatchSummary[] {
    const rows = db
      .prepare(
        `
        SELECT
          b.id,
          b.source_type,
          b.source_filename,
          b.account_id,
          a.name AS account_name,
          b.parser_profile,
          b.status,
          b.total_rows,
          b.inserted_rows,
          b.parse_notes,
          b.created_at,
          COALESCE(SUM(CASE WHEN r.status = 'parsed' THEN 1 ELSE 0 END), 0) AS parsed_count,
          COALESCE(SUM(CASE WHEN r.status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted_count,
          COALESCE(SUM(CASE WHEN r.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
          COALESCE(SUM(CASE WHEN r.status = 'duplicate' THEN 1 ELSE 0 END), 0) AS duplicate_count,
          COALESCE(SUM(CASE WHEN r.status = 'needs_review' THEN 1 ELSE 0 END), 0) AS needs_review_count
        FROM exp_import_batches AS b
        LEFT JOIN exp_accounts AS a ON a.id = b.account_id
        LEFT JOIN exp_import_rows_raw AS r ON r.batch_id = b.id
        GROUP BY b.id, b.source_type, b.source_filename, b.account_id, a.name, b.parser_profile, b.status, b.total_rows, b.inserted_rows, b.parse_notes, b.created_at
        ORDER BY b.id DESC
        LIMIT ?
        `
      )
      .all(limit) as ImportBatchSummaryRow[]

    return rows.map((row) => this.mapImportBatchSummary(row))
  }

  private getImportBatchWithDb(db: Database.Database, batchId: number): ImportBatchDetail {
    const summaryRow = db
      .prepare(
        `
        SELECT
          b.id,
          b.source_type,
          b.source_filename,
          b.account_id,
          a.name AS account_name,
          b.parser_profile,
          b.status,
          b.total_rows,
          b.inserted_rows,
          b.parse_notes,
          b.created_at,
          COALESCE(SUM(CASE WHEN r.status = 'parsed' THEN 1 ELSE 0 END), 0) AS parsed_count,
          COALESCE(SUM(CASE WHEN r.status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted_count,
          COALESCE(SUM(CASE WHEN r.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
          COALESCE(SUM(CASE WHEN r.status = 'duplicate' THEN 1 ELSE 0 END), 0) AS duplicate_count,
          COALESCE(SUM(CASE WHEN r.status = 'needs_review' THEN 1 ELSE 0 END), 0) AS needs_review_count
        FROM exp_import_batches AS b
        LEFT JOIN exp_accounts AS a ON a.id = b.account_id
        LEFT JOIN exp_import_rows_raw AS r ON r.batch_id = b.id
        WHERE b.id = ?
        GROUP BY b.id, b.source_type, b.source_filename, b.account_id, a.name, b.parser_profile, b.status, b.total_rows, b.inserted_rows, b.parse_notes, b.created_at
        LIMIT 1
        `
      )
      .get(batchId) as ImportBatchSummaryRow | undefined

    if (!summaryRow) {
      throw new Error(`import batch ${batchId} not found`)
    }

    const rows = db
      .prepare(
        `
        SELECT
          id,
          batch_id,
          row_no,
          raw_text,
          parsed_tx_date,
          posted_date,
          parsed_description,
          merchant_candidate,
          reference_text,
          parsed_amount,
          confidence,
          parse_notes,
          status,
          error,
          transaction_id,
          created_at
        FROM exp_import_rows_raw
        WHERE batch_id = ?
        ORDER BY row_no ASC, id ASC
        `
      )
      .all(batchId) as ImportRowDbRecord[]

    return {
      ...this.mapImportBatchSummary(summaryRow),
      rows: rows.map((row) => this.mapImportRowRecord(row)),
    }
  }

  private mapImportBatchSummary(row: ImportBatchSummaryRow): ImportBatchSummary {
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceFilename: row.source_filename,
      accountId: row.account_id,
      accountName: row.account_name,
      parserProfile: row.parser_profile,
      status: row.status,
      totalRows: Number(row.total_rows || 0),
      insertedRows: Number(row.inserted_rows || 0),
      parseNotes: row.parse_notes,
      createdAt: row.created_at,
      counts: {
        parsed: Number(row.parsed_count || 0),
        accepted: Number(row.accepted_count || 0),
        rejected: Number(row.rejected_count || 0),
        duplicate: Number(row.duplicate_count || 0),
        needs_review: Number(row.needs_review_count || 0),
      },
    }
  }

  private mapImportRowRecord(row: ImportRowDbRecord): ImportRowRecord {
    return {
      id: row.id,
      batchId: row.batch_id,
      rowNo: row.row_no,
      rawText: row.raw_text,
      parsedTxDate: row.parsed_tx_date,
      postedDate: row.posted_date,
      parsedDescription: row.parsed_description,
      merchantCandidate: row.merchant_candidate,
      referenceText: row.reference_text,
      parsedAmount: row.parsed_amount,
      confidence: Number(row.confidence || 0),
      parseNotes: row.parse_notes,
      status: row.status,
      error: row.error,
      transactionId: row.transaction_id,
      createdAt: row.created_at,
    }
  }

  private refreshImportBatchMetrics(db: Database.Database, batchId: number): void {
    const counts = db
      .prepare(
        `
        SELECT
          COUNT(*) AS total_rows,
          COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted_rows,
          COALESCE(SUM(CASE WHEN status IN ('needs_review', 'duplicate') THEN 1 ELSE 0 END), 0) AS open_review_rows
        FROM exp_import_rows_raw
        WHERE batch_id = ?
        `
      )
      .get(batchId) as
      | {
          total_rows: number | null
          accepted_rows: number | null
          open_review_rows: number | null
        }
      | undefined

    const openReviewRows = Number(counts?.open_review_rows || 0)
    const nextStatus = openReviewRows > 0 ? 'reviewed' : 'done'

    db.prepare(
      `
      UPDATE exp_import_batches
      SET total_rows = ?, inserted_rows = ?, status = ?
      WHERE id = ?
      `
    ).run(Number(counts?.total_rows || 0), Number(counts?.accepted_rows || 0), nextStatus, batchId)
  }

  private getImportRowWithContext(
    db: Database.Database,
    rowId: number
  ):
    | (ImportRowDbRecord & {
        account_id: number | null
      })
    | null {
    const row = db
      .prepare(
        `
        SELECT
          r.id,
          r.batch_id,
          r.row_no,
          r.raw_text,
          r.parsed_tx_date,
          r.posted_date,
          r.parsed_description,
          r.merchant_candidate,
          r.reference_text,
          r.parsed_amount,
          r.confidence,
          r.parse_notes,
          r.status,
          r.error,
          r.transaction_id,
          r.created_at,
          b.account_id
        FROM exp_import_rows_raw AS r
        INNER JOIN exp_import_batches AS b ON b.id = r.batch_id
        WHERE r.id = ?
        LIMIT 1
        `
      )
      .get(rowId) as (ImportRowDbRecord & { account_id: number | null }) | undefined

    return row ?? null
  }

  private getImportRowOrThrow(db: Database.Database, rowId: number): ImportRowRecord {
    const row = db
      .prepare(
        `
        SELECT
          id,
          batch_id,
          row_no,
          raw_text,
          parsed_tx_date,
          posted_date,
          parsed_description,
          merchant_candidate,
          reference_text,
          parsed_amount,
          confidence,
          parse_notes,
          status,
          error,
          transaction_id,
          created_at
        FROM exp_import_rows_raw
        WHERE id = ?
        LIMIT 1
        `
      )
      .get(rowId) as ImportRowDbRecord | undefined

    if (!row) {
      throw new Error(`import row ${rowId} not found`)
    }

    return this.mapImportRowRecord(row)
  }

  private getCategorizationRuleOrThrow(
    db: Database.Database,
    ruleId: number
  ): CategorizationRuleRecord {
    const row = db
      .prepare(
        `
        SELECT
          r.id,
          r.priority,
          r.match_type,
          r.pattern,
          r.category_id,
          c.name AS category_name,
          r.account_id,
          a.name AS account_name,
          r.active,
          r.created_at
        FROM exp_categorization_rules AS r
        INNER JOIN exp_categories AS c ON c.id = r.category_id
        LEFT JOIN exp_accounts AS a ON a.id = r.account_id
        WHERE r.id = ?
        LIMIT 1
        `
      )
      .get(ruleId) as CategorizationRuleRow | undefined

    if (!row) {
      throw new Error(`categorization rule ${ruleId} not found`)
    }

    return this.mapCategorizationRuleRecord(row)
  }

  private mapCategorizationRuleRecord(row: CategorizationRuleRow): CategorizationRuleRecord {
    return {
      id: row.id,
      priority: row.priority,
      matchType: row.match_type,
      pattern: row.pattern,
      categoryId: row.category_id,
      categoryName: row.category_name,
      accountId: row.account_id,
      accountName: row.account_name,
      active: row.active === 1,
      createdAt: row.created_at,
    }
  }

  private getBudgetPeriodWithRow(db: Database.Database, row: BudgetPeriodRow): BudgetPeriodRecord {
    const targets = db
      .prepare(
        `
        SELECT
          t.id,
          t.category_id,
          c.name AS category_name,
          t.target_amount,
          ABS(COALESCE(SUM(COALESCE(tx.amount_home, tx.amount)), 0)) AS actual_amount
        FROM exp_budget_targets AS t
        INNER JOIN exp_categories AS c ON c.id = t.category_id
        LEFT JOIN exp_transactions AS tx
          ON tx.category_id = t.category_id
         AND substr(tx.tx_date, 1, 7) = ?
         AND COALESCE(tx.amount_home, tx.amount) < 0
        WHERE t.period_id = ?
        GROUP BY t.id, t.category_id, c.name, t.target_amount
        ORDER BY c.name ASC
        `
      )
      .all(row.month, row.id) as BudgetTargetRow[]

    return {
      id: row.id,
      budgetId: row.budget_id,
      budgetName: row.budget_name,
      month: row.month,
      currency: row.currency,
      createdAt: row.created_at,
      targets: targets.map((target) => ({
        id: target.id,
        categoryId: target.category_id,
        categoryName: target.category_name,
        targetAmount: Number(target.target_amount),
        actualAmount: Number(target.actual_amount || 0),
        remainingAmount: Number(target.target_amount) - Number(target.actual_amount || 0),
      })),
    }
  }

  private getOrCreateBudget(db: Database.Database, name: string, currency: string): number {
    const existing = db.prepare('SELECT id FROM exp_budgets WHERE name = ? LIMIT 1').get(name) as
      | { id: number }
      | undefined
    if (existing) {
      return existing.id
    }

    const result = db
      .prepare('INSERT INTO exp_budgets(name, currency) VALUES(?, ?)')
      .run(name, currency)
    return Number(result.lastInsertRowid)
  }

  private normalizeTransactionDate(rawDate: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return rawDate
    }

    const match = rawDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
    if (!match) {
      return rawDate
    }

    const firstToken = match[1]
    const secondToken = match[2]
    const yearToken = match[3]
    if (!firstToken || !secondToken || !yearToken) {
      return rawDate
    }
    const year = yearToken.length === 2 ? `20${yearToken}` : yearToken
    const candidates = [
      `${year}-${this.pad(secondToken)}-${this.pad(firstToken)}`,
      `${year}-${this.pad(firstToken)}-${this.pad(secondToken)}`,
    ]

    for (const candidate of candidates) {
      if (this.isIsoDate(candidate)) {
        return candidate
      }
    }

    return rawDate
  }

  private resolveMerchant(db: Database.Database, description: string | null): number | null {
    const merchantCandidate = this.extractMerchantCandidate(description)
    if (!merchantCandidate) {
      return null
    }

    const normalizedMerchant = this.normalizeMerchantName(merchantCandidate)
    if (!normalizedMerchant) {
      return null
    }

    const existingMerchant = db
      .prepare(
        `
        SELECT id
        FROM exp_merchants
        WHERE normalized_name = ?
        LIMIT 1
        `
      )
      .get(normalizedMerchant) as { id: number } | undefined
    if (existingMerchant) {
      return existingMerchant.id
    }

    const displayName = this.canonicalizeMerchantName(merchantCandidate)
    const insertResult = db
      .prepare(
        `
        INSERT INTO exp_merchants(name, normalized_name)
        VALUES(?, ?)
        `
      )
      .run(displayName, normalizedMerchant)

    return Number(insertResult.lastInsertRowid)
  }

  private extractMerchantCandidate(description: string | null): string | null {
    const normalizedDescription = this.normalizeOptionalText(description)
    if (!normalizedDescription) {
      return null
    }

    let candidate = normalizedDescription
      .replace(
        /^(card payment|payment to|purchase|debit card purchase|online purchase|cash withdrawal at)\s+/i,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim()

    candidate = candidate.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').trim()

    return candidate || normalizedDescription
  }

  private normalizeMerchantName(merchantCandidate: string): string | null {
    const normalized = merchantCandidate
      .normalize('NFKD')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\b(inc|ltd|llc|corp|corporation|co)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()

    return normalized || null
  }

  private canonicalizeMerchantName(merchantCandidate: string): string {
    return this.smartTitleCase(merchantCandidate.replace(/[^\w\s&/-]+/g, ' ').replace(/\s+/g, ' '))
  }

  private pickCategory(
    db: Database.Database,
    description: string,
    amount: number,
    accountId: number | null
  ): number | null {
    const normalizedDescription = (description || '').toLowerCase()
    const rows = db
      .prepare(
        `
        SELECT category_id, match_type, pattern
        FROM exp_categorization_rules
        WHERE active = 1
          AND (account_id = ? OR account_id IS NULL)
        ORDER BY
          CASE WHEN account_id = ? THEN 0 ELSE 1 END ASC,
          priority ASC,
          id ASC
        `
      )
      .all(accountId, accountId) as Array<{
      category_id: number
      match_type: string | null
      pattern: string | null
    }>

    for (const row of rows) {
      const matchType = (row.match_type || 'contains').toLowerCase()
      const pattern = row.pattern || ''
      if (!pattern) {
        continue
      }

      const normalizedPattern = pattern.toLowerCase()
      if (matchType === 'contains' && normalizedDescription.includes(normalizedPattern)) {
        return row.category_id
      }
      if (matchType === 'exact' && normalizedPattern === normalizedDescription) {
        return row.category_id
      }
      if (matchType === 'regex') {
        try {
          if (new RegExp(pattern, 'i').test(description || '')) {
            return row.category_id
          }
        } catch {}
      }
    }

    const keywordBuckets: Array<[string, string[]]> = [
      ['Transfer', ['withdrawing savings', 'depositing savings']],
      ['Income', ['transfer from', 'salary', 'refund', 'cashback', 'interest', 'received']],
      ['Investment', ['pmmf placement', 'investment', 'money market', 'mutual fund']],
      [
        'Transfer',
        ['international transfer', 'bank transfer', 'transfer to', 'to: alessandro metelli'],
      ],
      ['Transport', ['grab', 'uber', 'taxi', 'fuel', 'petrol', 'gas station']],
      ['Groceries', ['supermarket', 'shopsm', 'sm supermarket', 'sm store', 'grocery', 'market']],
      ['Dining', ['cafe', 'coffee', 'starbucks', 'restaurant', 'food', 'soft habit']],
      [
        'Subscriptions',
        ['netflix', 'spotify', 'metal plan fee', 'subscription', 'claude.ai', 'openai'],
      ],
      ['Software/Cloud', ['vercel', 'railway', 'google cloud', 'alchemy']],
      ['Fitness', ['f45', 'fitness', 'gym']],
      ['Travel', ['cebu pacific', 'air', 'hotel', 'booking', 'flight']],
      ['Fees', ['fee', 'atm', 'cash withdrawal', 'non-revolut fee']],
    ]

    for (const [categoryName, keywords] of keywordBuckets) {
      if (!keywords.some((keyword) => normalizedDescription.includes(keyword))) {
        continue
      }

      const categoryRow = db
        .prepare('SELECT id FROM exp_categories WHERE name = ?')
        .get(categoryName) as { id: number } | undefined
      if (categoryRow) {
        return categoryRow.id
      }
    }

    const fallbackName = amount > 0 ? 'Income' : 'Uncategorized'
    const fallbackRow = db
      .prepare('SELECT id FROM exp_categories WHERE name = ?')
      .get(fallbackName) as { id: number } | undefined

    return fallbackRow?.id ?? null
  }

  private transactionExists(
    db: Database.Database,
    accountId: number,
    parsedEntry: ParsedExpenseTransaction,
    rawLine: string
  ): boolean {
    const sourceHash = this.buildSourceHash(accountId, parsedEntry, rawLine)
    const byHash = db
      .prepare('SELECT 1 FROM exp_transactions WHERE source_hash = ? LIMIT 1')
      .get(sourceHash)
    if (byHash) {
      return true
    }

    const byBusinessKey = db
      .prepare(
        `
        SELECT 1
        FROM exp_transactions
        WHERE account_id = ?
          AND tx_date = ?
          AND lower(trim(description)) = lower(trim(?))
          AND amount = ?
        LIMIT 1
        `
      )
      .get(accountId, parsedEntry.tx_date, parsedEntry.description, parsedEntry.amount)

    return Boolean(byBusinessKey)
  }

  private buildSourceHash(
    accountId: number,
    parsedEntry: ParsedExpenseTransaction,
    rawLine: string
  ): string {
    const normalizedLine = rawLine.trim().toLowerCase().replace(/\s+/g, ' ')
    const source = `${accountId}|${parsedEntry.tx_date}|${parsedEntry.description.trim().toLowerCase()}|${parsedEntry.amount.toFixed(2)}|${normalizedLine}`
    return createHash('sha256').update(source).digest('hex')
  }

  private buildManualAcceptSourceHash(
    accountId: number,
    parsedEntry: ParsedExpenseTransaction,
    rawLine: string,
    rowId: number
  ): string {
    const normalizedLine = rawLine.trim().toLowerCase().replace(/\s+/g, ' ')
    const source = `${accountId}|${parsedEntry.tx_date}|${parsedEntry.description.trim().toLowerCase()}|${parsedEntry.amount.toFixed(2)}|${normalizedLine}|manual-accept|${rowId}`
    return createHash('sha256').update(source).digest('hex')
  }

  private getOrCreateAccount(db: Database.Database, accountName: string): number {
    const name = (accountName || 'Default Account').trim()
    const inferredCurrency = this.inferCurrency(name)
    const existing = db.prepare('SELECT id, currency FROM exp_accounts WHERE name = ?').get(name) as
      | { id: number; currency: string | null }
      | undefined

    if (existing) {
      if ((existing.currency || '').toUpperCase() !== inferredCurrency) {
        db.prepare('UPDATE exp_accounts SET currency = ? WHERE id = ?').run(
          inferredCurrency,
          existing.id
        )
      }
      return existing.id
    }

    const result = db
      .prepare('INSERT INTO exp_accounts(name, currency) VALUES(?, ?)')
      .run(name, inferredCurrency)
    return Number(result.lastInsertRowid)
  }

  private inferCurrency(accountName: string): string {
    return accountName.toLowerCase().includes('usd') ? 'USD' : 'PHP'
  }

  private async getFxRate(
    db: Database.Database,
    baseCurrency: string,
    quoteCurrency: string,
    rateDate: string
  ): Promise<number> {
    const base = (baseCurrency || 'PHP').toUpperCase()
    const quote = (quoteCurrency || 'PHP').toUpperCase()
    const resolvedDate = (rateDate || '').trim()

    if (base === quote) {
      return 1
    }

    const cacheKey = this.fxCacheKey(base, quote, resolvedDate)
    const cached = this.fxRateCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    const directRate = db
      .prepare(
        `
        SELECT rate
        FROM exp_fx_rates
        WHERE base_currency = ? AND quote_currency = ? AND rate_date = ?
        LIMIT 1
        `
      )
      .get(base, quote, resolvedDate) as { rate: number } | undefined
    if (directRate) {
      this.fxRateCache.set(cacheKey, Number(directRate.rate))
      return Number(directRate.rate)
    }

    try {
      const fetchedRate = await this.fetchFxRateOnline(base, quote, resolvedDate)
      db.prepare(
        `
        INSERT INTO exp_fx_rates(base_currency, quote_currency, rate_date, rate, provider)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(base_currency, quote_currency, rate_date)
        DO UPDATE SET rate = excluded.rate, provider = excluded.provider
        `
      ).run(base, quote, resolvedDate, fetchedRate, 'frankfurter')
      this.fxRateCache.set(cacheKey, fetchedRate)
      return fetchedRate
    } catch {}

    const fallbackRate = db
      .prepare(
        `
        SELECT rate
        FROM exp_fx_rates
        WHERE base_currency = ? AND quote_currency = ? AND rate_date <= ?
        ORDER BY rate_date DESC
        LIMIT 1
        `
      )
      .get(base, quote, resolvedDate) as { rate: number } | undefined
    if (fallbackRate) {
      const resolvedRate = Number(fallbackRate.rate)
      this.fxRateCache.set(cacheKey, resolvedRate)
      return resolvedRate
    }

    const defaultRate = base === 'USD' && quote === 'PHP' ? 58 : 1
    this.fxRateCache.set(cacheKey, defaultRate)
    return defaultRate
  }

  private async fetchFxRateOnline(
    baseCurrency: string,
    quoteCurrency: string,
    rateDate: string
  ): Promise<number> {
    if (baseCurrency === quoteCurrency) {
      return 1
    }

    const url = `https://api.frankfurter.app/${rateDate}?from=${baseCurrency}&to=${quoteCurrency}`
    const response = await fetch(url, { headers: { accept: 'application/json' } })

    if (!response.ok) {
      throw new Error(`FX lookup failed with status ${response.status}`)
    }

    const payload = (await response.json()) as {
      rates?: Record<string, number>
    }
    const rate = payload.rates?.[quoteCurrency]
    if (typeof rate !== 'number') {
      throw new Error(`FX rate unavailable for ${baseCurrency}/${quoteCurrency} on ${rateDate}`)
    }

    return rate
  }

  private looksLikeIncome(description: string): boolean {
    return [
      'transfer from',
      'deposit',
      'withdrawing savings',
      'salary',
      'refund',
      'cashback',
      'interest',
      'received',
    ].some((marker) => description.includes(marker))
  }

  private looksLikeOutflow(description: string): boolean {
    const outflowMarkers = ['pos w/d', 'sent via', 'w/d ', 'withdraw', 'interest withheld']
    const inflowMarkers = ['received from', 'interest pay', 'cashback', 'refund']

    if (inflowMarkers.some((marker) => description.includes(marker))) {
      return false
    }
    if (description.includes('transfer') && !description.includes('from')) {
      return true
    }

    return outflowMarkers.some((marker) => description.includes(marker))
  }

  private normalizeMonthDate(rawDate: string): string {
    const date = new Date(`${rawDate} UTC`)
    if (Number.isNaN(date.getTime())) {
      return rawDate
    }

    return date.toISOString().slice(0, 10)
  }

  private normalizeDayMonthDate(rawDate: string): string {
    const match = rawDate.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/)
    if (!match) {
      return rawDate
    }

    const [, day, monthName, year] = match
    const date = new Date(`${monthName} ${day}, ${year} UTC`)
    if (Number.isNaN(date.getTime())) {
      return rawDate
    }

    return date.toISOString().slice(0, 10)
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private getPreviousMonthKey(monthValue: string): string | null {
    const [yearRaw, monthRaw] = monthValue.split('-')
    const year = Number(yearRaw)
    const month = Number(monthRaw)
    if (!year || !month) {
      return null
    }

    const previous = new Date(year, month - 2, 1)
    return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    const normalized = (value || '').replace(/\s+/g, ' ').trim()
    return normalized || null
  }

  private pad(value: string): string {
    return value.padStart(2, '0')
  }

  private fxCacheKey(base: string, quote: string, date: string): string {
    return `${base}:${quote}:${date}`
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unexpected error'
  }

  private fileExists(filePath: string): boolean {
    return existsSync(filePath)
  }

  private isIsoDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  }
}
