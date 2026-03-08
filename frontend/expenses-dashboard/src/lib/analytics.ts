import type {
  DashboardAnalytics,
  LineChartModel,
  LineSeries,
  MonthSummary,
  PieSegment,
  TransactionRecord,
} from '../types'
import {
  getCategoryKind,
  getCategoryName,
  getHomeAmount,
  monthKey,
  monthLabel,
  weekLabel,
  weekStart,
} from './format'

const PIE_COLORS = [
  '#0f5bd8',
  '#0891b2',
  '#059669',
  '#ea580c',
  '#dc2626',
  '#7c3aed',
  '#ca8a04',
  '#2563eb',
  '#be123c',
  '#475569',
]
const DEFAULT_COLOR = '#0f5bd8'

export function buildDashboardAnalytics(rows: TransactionRecord[]): DashboardAnalytics {
  const months = buildMonths(rows)
  const categoryColors = buildCategoryColors(rows)
  const pieSegments = buildPieSegments(rows, categoryColors)
  const lineChart = buildLineChart(rows, categoryColors)

  return {
    months,
    pieSegments,
    lineChart,
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

function buildLineChart(
  rows: TransactionRecord[],
  categoryColors: Map<string, string>
): LineChartModel {
  const weeklyKeys = new Set<string>()
  const categoryWeeklyTotals = new Map<string, Map<string, number>>()

  for (const row of rows) {
    if (!isExpense(row)) {
      continue
    }

    const category = getCategoryName(row)
    const weekKey = weekStart(row.tx_date)
    if (!weekKey) {
      continue
    }

    weeklyKeys.add(weekKey)

    let categoryMap = categoryWeeklyTotals.get(category)
    if (!categoryMap) {
      categoryMap = new Map<string, number>()
      categoryWeeklyTotals.set(category, categoryMap)
    }

    categoryMap.set(weekKey, (categoryMap.get(weekKey) ?? 0) + Math.abs(getHomeAmount(row)))
  }

  const weeks = [...weeklyKeys].sort((left, right) => left.localeCompare(right))
  const series: LineSeries[] = [...categoryWeeklyTotals.entries()]
    .map(([category, valuesByWeek]) => {
      const values = weeks.map((week) => valuesByWeek.get(week) ?? 0)
      const total = values.reduce((sum, value) => sum + value, 0)

      return {
        category,
        color: categoryColors.get(category) ?? DEFAULT_COLOR,
        total,
        values,
      }
    })
    .sort((left, right) => right.total - left.total)
    .slice(0, 10)

  return {
    weeks,
    labels: weeks.map((week) => weekLabel(week)),
    series,
    maxY: Math.max(1, ...series.flatMap((entry) => entry.values)),
  }
}

function isExpense(row: TransactionRecord): boolean {
  return getCategoryKind(row) === 'expense' && getHomeAmount(row) < 0
}
