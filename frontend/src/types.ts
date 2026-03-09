export type CurrencyViewMode = 'home' | 'native' | 'both'

export interface OverviewResponse {
  income: number
  expenses: number
  net: number
  txCount: number
}

export interface TransactionRecord {
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

export interface ApiStatusResponse {
  ok: boolean
  error?: string
}

export interface ImportStatusCounts {
  parsed: number
  accepted: number
  rejected: number
  duplicate: number
  needs_review: number
}

export interface ImportPdfResponse extends ApiStatusResponse {
  batchId?: number
  parsedRows?: number
  insertedTransactions?: number
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

export interface ImportRowActionResponse {
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

export interface BackfillFxResponse extends ApiStatusResponse {
  updated?: number
}

export interface MonthSummary {
  key: string
  label: string
  count: number
}

export interface PieSegment {
  name: string
  value: number
  pct: number
  color: string
}

export interface SpendingPacePoint {
  day: number
  label: string
  current: number
  previous: number | null
}

export interface SpendingDayBreakdown {
  id: number
  description: string
  category: string
  amount: number
}

export interface SpendingDayHighlight {
  day: number
  label: string
  total: number
  transactions: SpendingDayBreakdown[]
}

export interface LineChartModel {
  monthKey: string | null
  monthLabel: string
  comparisonMonthLabel: string | null
  points: SpendingPacePoint[]
  maxY: number
  total: number
  comparisonTotal: number | null
  comparisonToDate: number | null
  projectedTotal: number | null
  daysElapsed: number
  daysInMonth: number
  isCurrentMonth: boolean
  largestDay: SpendingDayHighlight | null
}

export interface DashboardAnalytics {
  months: MonthSummary[]
  pieSegments: PieSegment[]
}
