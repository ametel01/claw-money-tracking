import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

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

interface TableInfoRow {
  name: string
}

interface OverviewRow {
  income: number | null
  expenses: number | null
  tx_count: number | null
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

  listTransactions(limit: number): TransactionRow[] {
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
          ORDER BY t.tx_date DESC, t.id DESC
          LIMIT ?
          `
          )
          .all(limit) as TransactionRow[]
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
    const parsedRows = this.parsePdfImportRows(text.split(/\r?\n/).filter((line) => line.trim()))

    return this.withDatabase(async (db) => {
      const accountId = this.getOrCreateAccount(db, accountName)
      const accountRow = db
        .prepare('SELECT currency FROM exp_accounts WHERE id = ?')
        .get(accountId) as { currency: string | null } | undefined
      const accountCurrency = (accountRow?.currency || 'PHP').toUpperCase()

      const batchResult = db
        .prepare(
          `
          INSERT INTO exp_import_batches(source_type, source_filename, account_id, status, total_rows)
          VALUES('pdf', ?, ?, ?, 0)
          `
        )
        .run(path.basename(pdfPath), accountId, 'parsed')
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
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )

      for (const [index, parsedRow] of parsedRows.entries()) {
        parsedCount += 1
        const normalizedRow = this.normalizeParsedImportRow(parsedRow)
        const rawText = this.buildRawImportText(normalizedRow)
        const referenceText = normalizedRow.referenceText ?? normalizedRow.description
        const merchantCandidate = normalizedRow.merchantCandidate ?? normalizedRow.description
        const reviewNotes = this.buildReviewNotes(normalizedRow)
        let status: 'accepted' | 'duplicate' | 'needs_review' = 'needs_review'
        let transactionId: number | null = null

        if (
          normalizedRow.txDate &&
          normalizedRow.description &&
          normalizedRow.amount != null &&
          reviewNotes.length === 0
        ) {
          const transactionCandidate: ParsedExpenseTransaction = {
            tx_date: normalizedRow.txDate,
            description: normalizedRow.description,
            amount: normalizedRow.amount,
            confidence: normalizedRow.confidence,
          }

          if (this.transactionExists(db, transactionCandidate, rawText)) {
            status = 'duplicate'
          } else {
            const categoryId = this.pickCategory(
              db,
              transactionCandidate.description,
              transactionCandidate.amount
            )
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
                amountOriginal,
                accountCurrency,
                amountOriginal,
                amountHome,
                fxRate,
                transactionCandidate.tx_date,
                categoryId,
                batchId,
                this.buildSourceHash(transactionCandidate, rawText)
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
          reviewNotes.join('; ') || null,
          status,
          transactionId
        )
      }

      db.prepare(
        `
        UPDATE exp_import_batches
        SET total_rows = ?, inserted_rows = ?, status = ?
        WHERE id = ?
        `
      ).run(parsedCount, insertedCount, 'done', batchId)

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
      if (!existingColumns.has('amount_home')) {
        db.exec('ALTER TABLE exp_transactions ADD COLUMN amount_home REAL')
      }
      if (!existingColumns.has('fx_rate_used')) {
        db.exec('ALTER TABLE exp_transactions ADD COLUMN fx_rate_used REAL')
      }
      if (!existingColumns.has('fx_date')) {
        db.exec('ALTER TABLE exp_transactions ADD COLUMN fx_date TEXT')
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
    if (this.looksLikeBpiAccountActivities(lines)) {
      return this.parseBpiAccountActivities(lines)
    }

    if (this.looksLikeRevolutStatement(lines)) {
      return this.parseRevolutStatement(lines)
    }

    return this.parseGenericPdfLines(lines)
  }

  private parsePdfImportRows(lines: string[]): ParsedImportRow[] {
    return this.parsePdfLines(lines).map((row) => this.toParsedImportRow(row))
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

  private toParsedImportRow(row: ParsedExpenseTransaction): ParsedImportRow {
    const description = this.normalizeOptionalText(row.description)
    return {
      txDate: this.normalizeOptionalText(row.tx_date),
      postedDate: this.normalizeOptionalText(row.tx_date),
      description,
      amount: Number.isFinite(row.amount) ? row.amount : null,
      confidence: Number.isFinite(row.confidence) ? row.confidence : 0,
      rawText: `${row.tx_date} ${row.description} ${row.amount}`.trim(),
      merchantCandidate: description,
      referenceText: description,
      parseNotes: null,
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

  private buildReviewNotes(row: ParsedImportRow): string[] {
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
    if (row.parseNotes) {
      notes.add(row.parseNotes)
    }

    return [...notes]
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

  private pickCategory(db: Database.Database, description: string, amount: number): number | null {
    const normalizedDescription = (description || '').toLowerCase()
    const rows = db
      .prepare(
        `
        SELECT category_id, match_type, pattern
        FROM exp_categorization_rules
        WHERE active = 1
        ORDER BY priority ASC, id ASC
        `
      )
      .all() as Array<{ category_id: number; match_type: string | null; pattern: string | null }>

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
    parsedEntry: ParsedExpenseTransaction,
    rawLine: string
  ): boolean {
    const sourceHash = this.buildSourceHash(parsedEntry, rawLine)
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
        WHERE tx_date = ?
          AND lower(trim(description)) = lower(trim(?))
          AND amount = ?
        LIMIT 1
        `
      )
      .get(parsedEntry.tx_date, parsedEntry.description, parsedEntry.amount)

    return Boolean(byBusinessKey)
  }

  private buildSourceHash(parsedEntry: ParsedExpenseTransaction, rawLine: string): string {
    const normalizedLine = rawLine.trim().toLowerCase().replace(/\s+/g, ' ')
    const source = `${parsedEntry.tx_date}|${parsedEntry.description.trim().toLowerCase()}|${parsedEntry.amount.toFixed(2)}|${normalizedLine}`
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
