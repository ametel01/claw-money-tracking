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

export interface ImportPdfResponse extends ApiStatusResponse {
  batchId?: number
  parsedRows?: number
  insertedTransactions?: number
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

export interface LineSeries {
  category: string
  color: string
  total: number
  values: number[]
}

export interface LineChartModel {
  weeks: string[]
  labels: string[]
  series: LineSeries[]
  maxY: number
}

export interface DashboardAnalytics {
  months: MonthSummary[]
  pieSegments: PieSegment[]
  lineChart: LineChartModel
}
