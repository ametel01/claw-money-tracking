import type {
  CategoryBreakdownItem,
  DashboardAnalytics,
  LineChartModel,
  MonthSummary,
  MonthlyAnalyticsSummary,
  PieSegment,
  TransactionRecord,
} from '../types'
import { getCategoryKind, getCategoryName, getHomeAmount, monthKey, monthLabel } from './format'

const PIE_COLORS = [
  '#c8f03c',
  '#3a7cf0',
  '#00cba8',
  '#f03c5a',
  '#f0a83c',
  '#a03cf0',
  '#3cf0c8',
  '#f07a3c',
  '#3cc8f0',
  '#8890a0',
]
const DEFAULT_COLOR = '#0f5bd8'

export function monthlySummaryToMonthTabs(rows: MonthlyAnalyticsSummary[]): MonthSummary[] {
  return rows.map((row) => ({
    key: row.month,
    label: monthLabel(row.month),
    count: row.transactionCount,
  }))
}

export function categoryBreakdownToPieSegments(rows: CategoryBreakdownItem[]): PieSegment[] {
  return rows.map((row, index) => ({
    name: row.categoryName,
    value: row.total,
    pct: row.percentage,
    color: PIE_COLORS[index % PIE_COLORS.length] ?? DEFAULT_COLOR,
  }))
}

export function buildDashboardAnalytics(rows: TransactionRecord[]): DashboardAnalytics {
  const months = buildMonths(rows)
  const categoryColors = buildCategoryColors(rows)
  const pieSegments = buildPieSegments(rows, categoryColors)

  return {
    months,
    pieSegments,
  }
}

function buildMonths(rows: TransactionRecord[]): MonthSummary[] {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const key = monthKey(row.tx_date)
    if (!key) {
      continue
    }

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([key, count]) => ({
      key,
      label: monthLabel(key),
      count,
    }))
}

function buildCategoryColors(rows: TransactionRecord[]): Map<string, string> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    if (!isExpense(row)) {
      continue
    }

    const category = getCategoryName(row)
    totals.set(category, (totals.get(category) ?? 0) + Math.abs(getHomeAmount(row)))
  }

  const colorEntries: Array<[string, string]> = [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([category], index) => [category, PIE_COLORS[index % PIE_COLORS.length] ?? DEFAULT_COLOR])

  return new Map(colorEntries)
}

function buildPieSegments(
  rows: TransactionRecord[],
  categoryColors: Map<string, string>
): PieSegment[] {
  const totals = new Map<string, number>()

  for (const row of rows) {
    if (!isExpense(row)) {
      continue
    }

    const category = getCategoryName(row)
    totals.set(category, (totals.get(category) ?? 0) + Math.abs(getHomeAmount(row)))
  }

  const topCategories = [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8)
  const total = topCategories.reduce((sum, [, value]) => sum + value, 0)

  if (total <= 0) {
    return []
  }

  return topCategories.map(([name, value]) => ({
    name,
    value,
    pct: (value / total) * 100,
    color: categoryColors.get(name) ?? DEFAULT_COLOR,
  }))
}

export function buildSpendingPaceChart(
  rows: TransactionRecord[],
  selectedMonth: string | null
): LineChartModel {
  const resolvedMonth = selectedMonth ?? buildMonths(rows)[0]?.key ?? null
  if (!resolvedMonth) {
    return emptyLineChartModel()
  }

  const daysInMonth = getDaysInMonth(resolvedMonth)
  if (!daysInMonth) {
    return emptyLineChartModel()
  }

  const today = new Date()
  const isCurrentMonth = resolvedMonth === toMonthKey(today)
  const daysElapsed = isCurrentMonth ? Math.min(today.getDate(), daysInMonth) : daysInMonth
  const currentDailyTotals = new Array<number>(daysInMonth).fill(0)
  const currentDayTransactions = new Map<number, TransactionRecord[]>()

  const comparisonMonthKey = getPreviousMonthKey(resolvedMonth)
  const comparisonDays = comparisonMonthKey ? getDaysInMonth(comparisonMonthKey) : 0
  const comparisonDailyTotals = new Array<number>(comparisonDays).fill(0)

  for (const row of rows) {
    if (!isExpense(row)) {
      continue
    }

    const rowMonth = monthKey(row.tx_date)
    const day = getDayOfMonth(row.tx_date)
    if (!day) {
      continue
    }

    const amount = Math.abs(getHomeAmount(row))

    if (rowMonth === resolvedMonth && day <= daysInMonth) {
      const index = day - 1
      currentDailyTotals[index] = (currentDailyTotals[index] ?? 0) + amount
      currentDayTransactions.set(day, [...(currentDayTransactions.get(day) ?? []), row])
      continue
    }

    if (comparisonMonthKey && rowMonth === comparisonMonthKey && day <= comparisonDays) {
      const index = day - 1
      comparisonDailyTotals[index] = (comparisonDailyTotals[index] ?? 0) + amount
    }
  }

  const currentCumulative = toCumulativeTotals(currentDailyTotals)
  const comparisonCumulative = toCumulativeTotals(comparisonDailyTotals)
  const total =
    currentCumulative.length > 0 ? (currentCumulative[currentCumulative.length - 1] ?? 0) : 0
  const comparisonTotal =
    comparisonCumulative.length > 0
      ? (comparisonCumulative[comparisonCumulative.length - 1] ?? 0)
      : null
  const comparisonToDate =
    comparisonCumulative.length > 0
      ? (comparisonCumulative[Math.min(daysElapsed, comparisonCumulative.length) - 1] ?? 0)
      : null

  const projectedTotal =
    isCurrentMonth && daysElapsed > 0 && daysElapsed < daysInMonth
      ? ((currentCumulative[daysElapsed - 1] ?? 0) / daysElapsed) * daysInMonth
      : null

  const largestDayEntry = currentDailyTotals.reduce(
    (best, totalForDay, index) =>
      totalForDay > best.total ? { day: index + 1, total: totalForDay } : best,
    { day: 0, total: 0 }
  )

  return {
    monthKey: resolvedMonth,
    monthLabel: monthLabel(resolvedMonth),
    comparisonMonthLabel: comparisonMonthKey ? monthLabel(comparisonMonthKey) : null,
    points: currentCumulative.map((current, index) => ({
      day: index + 1,
      label: String(index + 1),
      current,
      previous:
        comparisonCumulative.length > 0
          ? (comparisonCumulative[Math.min(index, comparisonCumulative.length - 1)] ?? 0)
          : null,
    })),
    maxY: Math.max(
      1,
      ...currentCumulative,
      ...comparisonCumulative,
      projectedTotal ?? 0,
      largestDayEntry.total
    ),
    total,
    comparisonTotal,
    comparisonToDate,
    projectedTotal,
    daysElapsed,
    daysInMonth,
    isCurrentMonth,
    largestDay:
      largestDayEntry.total > 0
        ? {
            day: largestDayEntry.day,
            label: formatDayLabel(resolvedMonth, largestDayEntry.day),
            total: largestDayEntry.total,
            transactions: [...(currentDayTransactions.get(largestDayEntry.day) ?? [])]
              .sort((left, right) => Math.abs(getHomeAmount(right)) - Math.abs(getHomeAmount(left)))
              .slice(0, 3)
              .map((row) => ({
                id: row.id,
                description: row.description || '(no description)',
                category: getCategoryName(row),
                amount: Math.abs(getHomeAmount(row)),
              })),
          }
        : null,
  }
}

function isExpense(row: TransactionRecord): boolean {
  return getCategoryKind(row) === 'expense' && getHomeAmount(row) < 0
}

function emptyLineChartModel(): LineChartModel {
  return {
    monthKey: null,
    monthLabel: '',
    comparisonMonthLabel: null,
    points: [],
    maxY: 1,
    total: 0,
    comparisonTotal: null,
    comparisonToDate: null,
    projectedTotal: null,
    daysElapsed: 0,
    daysInMonth: 0,
    isCurrentMonth: false,
    largestDay: null,
  }
}

function getDaysInMonth(monthValue: string): number {
  const [yearRaw, monthRaw] = monthValue.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)

  if (!year || !month) {
    return 0
  }

  return new Date(year, month, 0).getDate()
}

function getPreviousMonthKey(monthValue: string): string | null {
  const [yearRaw, monthRaw] = monthValue.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)

  if (!year || !month) {
    return null
  }

  const previous = new Date(year, month - 2, 1)
  return toMonthKey(previous)
}

function getDayOfMonth(dateValue: string | null | undefined): number | null {
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : null
  if (!date || Number.isNaN(date.getTime())) {
    return null
  }

  return date.getDate()
}

function toCumulativeTotals(values: number[]): number[] {
  let runningTotal = 0
  return values.map((value) => {
    runningTotal += value
    return runningTotal
  })
}

function formatDayLabel(monthValue: string, day: number): string {
  const [yearRaw, monthRaw] = monthValue.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)

  if (!year || !month || !day) {
    return monthValue
  }

  return new Date(year, month - 1, day).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  })
}

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
