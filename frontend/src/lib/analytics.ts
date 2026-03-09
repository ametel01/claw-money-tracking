import type {
  CategoryBreakdownItem,
  DashboardAnalytics,
  LineChartModel,
  MonthSummary,
  MonthlyAnalyticsSummary,
  PieSegment,
  SpendingDayHighlight,
  SpendingPacePoint,
  TransactionRecord,
} from '../types';
import { getCategoryKind, getCategoryName, getHomeAmount, monthKey, monthLabel } from './format';

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
];
const DEFAULT_COLOR = '#0f5bd8';

interface SpendingPaceSeries {
  resolvedMonth: string;
  daysInMonth: number;
  isCurrentMonth: boolean;
  daysElapsed: number;
  comparisonMonthKey: string | null;
  comparisonDays: number;
  currentDailyTotals: number[];
  comparisonDailyTotals: number[];
  currentDayTransactions: Map<number, TransactionRecord[]>;
}

export function monthlySummaryToMonthTabs(rows: MonthlyAnalyticsSummary[]): MonthSummary[] {
  return rows.map((row) => ({
    key: row.month,
    label: monthLabel(row.month),
    count: row.transactionCount,
  }));
}

export function categoryBreakdownToPieSegments(rows: CategoryBreakdownItem[]): PieSegment[] {
  return rows.map((row, index) => ({
    name: row.categoryName,
    value: row.total,
    pct: row.percentage,
    color: PIE_COLORS[index % PIE_COLORS.length] ?? DEFAULT_COLOR,
  }));
}

export function buildDashboardAnalytics(rows: TransactionRecord[]): DashboardAnalytics {
  const months = buildMonths(rows);
  const categoryColors = buildCategoryColors(rows);
  const pieSegments = buildPieSegments(rows, categoryColors);

  return {
    months,
    pieSegments,
  };
}

function buildMonths(rows: TransactionRecord[]): MonthSummary[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = monthKey(row.tx_date);
    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([key, count]) => ({
      key,
      label: monthLabel(key),
      count,
    }));
}

function buildCategoryColors(rows: TransactionRecord[]): Map<string, string> {
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (!isExpense(row)) {
      continue;
    }

    const category = getCategoryName(row);
    totals.set(category, (totals.get(category) ?? 0) + Math.abs(getHomeAmount(row)));
  }

  const colorEntries: Array<[string, string]> = [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([category], index) => [category, PIE_COLORS[index % PIE_COLORS.length] ?? DEFAULT_COLOR]);

  return new Map(colorEntries);
}

function buildPieSegments(
  rows: TransactionRecord[],
  categoryColors: Map<string, string>,
): PieSegment[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (!isExpense(row)) {
      continue;
    }

    const category = getCategoryName(row);
    totals.set(category, (totals.get(category) ?? 0) + Math.abs(getHomeAmount(row)));
  }

  const topCategories = [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8);
  const total = topCategories.reduce((sum, [, value]) => sum + value, 0);

  if (total <= 0) {
    return [];
  }

  return topCategories.map(([name, value]) => ({
    name,
    value,
    pct: (value / total) * 100,
    color: categoryColors.get(name) ?? DEFAULT_COLOR,
  }));
}

export function buildSpendingPaceChart(
  rows: TransactionRecord[],
  selectedMonth: string | null,
): LineChartModel {
  const resolvedMonth = selectedMonth ?? buildMonths(rows)[0]?.key ?? null;
  if (!resolvedMonth) {
    return emptyLineChartModel();
  }

  const daysInMonth = getDaysInMonth(resolvedMonth);
  if (!daysInMonth) {
    return emptyLineChartModel();
  }

  const series = createSpendingPaceSeries(resolvedMonth, daysInMonth);
  populateSpendingPaceSeries(rows, series);

  const currentCumulative = toCumulativeTotals(series.currentDailyTotals);
  const comparisonCumulative = toCumulativeTotals(series.comparisonDailyTotals);
  const total =
    currentCumulative.length > 0 ? (currentCumulative[currentCumulative.length - 1] ?? 0) : 0;
  const comparisonTotal =
    comparisonCumulative.length > 0
      ? (comparisonCumulative[comparisonCumulative.length - 1] ?? 0)
      : null;
  const comparisonToDate = getComparisonToDate(comparisonCumulative, series.daysElapsed);
  const projectedTotal = getProjectedTotal(
    currentCumulative,
    series.isCurrentMonth,
    series.daysElapsed,
    daysInMonth,
  );
  const largestDay = buildLargestDayHighlight(
    resolvedMonth,
    series.currentDailyTotals,
    series.currentDayTransactions,
  );

  return {
    monthKey: resolvedMonth,
    monthLabel: monthLabel(resolvedMonth),
    comparisonMonthLabel: series.comparisonMonthKey ? monthLabel(series.comparisonMonthKey) : null,
    points: buildSpendingPacePoints(currentCumulative, comparisonCumulative),
    maxY: Math.max(
      1,
      ...currentCumulative,
      ...comparisonCumulative,
      projectedTotal ?? 0,
      largestDay?.total ?? 0,
    ),
    total,
    comparisonTotal,
    comparisonToDate,
    projectedTotal,
    daysElapsed: series.daysElapsed,
    daysInMonth,
    isCurrentMonth: series.isCurrentMonth,
    largestDay,
  };
}

function createSpendingPaceSeries(resolvedMonth: string, daysInMonth: number): SpendingPaceSeries {
  const today = new Date();
  const isCurrentMonth = resolvedMonth === toMonthKey(today);
  const comparisonMonthKey = getPreviousMonthKey(resolvedMonth);
  const comparisonDays = comparisonMonthKey ? getDaysInMonth(comparisonMonthKey) : 0;

  return {
    resolvedMonth,
    daysInMonth,
    isCurrentMonth,
    daysElapsed: isCurrentMonth ? Math.min(today.getDate(), daysInMonth) : daysInMonth,
    comparisonMonthKey,
    comparisonDays,
    currentDailyTotals: new Array<number>(daysInMonth).fill(0),
    comparisonDailyTotals: new Array<number>(comparisonDays).fill(0),
    currentDayTransactions: new Map<number, TransactionRecord[]>(),
  };
}

function populateSpendingPaceSeries(rows: TransactionRecord[], series: SpendingPaceSeries): void {
  for (const row of rows) {
    if (!isExpense(row)) {
      continue;
    }

    addExpenseToSpendingPaceSeries(row, series);
  }
}

function addExpenseToSpendingPaceSeries(row: TransactionRecord, series: SpendingPaceSeries): void {
  const day = getDayOfMonth(row.tx_date);
  if (!day) {
    return;
  }

  const rowMonth = monthKey(row.tx_date);
  const amount = Math.abs(getHomeAmount(row));

  if (rowMonth === series.resolvedMonth && day <= series.daysInMonth) {
    const index = day - 1;
    series.currentDailyTotals[index] = (series.currentDailyTotals[index] ?? 0) + amount;
    series.currentDayTransactions.set(day, [
      ...(series.currentDayTransactions.get(day) ?? []),
      row,
    ]);
    return;
  }

  if (
    series.comparisonMonthKey &&
    rowMonth === series.comparisonMonthKey &&
    day <= series.comparisonDays
  ) {
    const index = day - 1;
    series.comparisonDailyTotals[index] = (series.comparisonDailyTotals[index] ?? 0) + amount;
  }
}

function buildSpendingPacePoints(
  currentCumulative: number[],
  comparisonCumulative: number[],
): SpendingPacePoint[] {
  return currentCumulative.map((current, index) => ({
    day: index + 1,
    label: String(index + 1),
    current,
    previous:
      comparisonCumulative.length > 0
        ? (comparisonCumulative[Math.min(index, comparisonCumulative.length - 1)] ?? 0)
        : null,
  }));
}

function getComparisonToDate(comparisonCumulative: number[], daysElapsed: number): number | null {
  if (comparisonCumulative.length === 0) {
    return null;
  }

  return comparisonCumulative[Math.min(daysElapsed, comparisonCumulative.length) - 1] ?? 0;
}

function getProjectedTotal(
  currentCumulative: number[],
  isCurrentMonth: boolean,
  daysElapsed: number,
  daysInMonth: number,
): number | null {
  if (!isCurrentMonth || daysElapsed <= 0 || daysElapsed >= daysInMonth) {
    return null;
  }

  return ((currentCumulative[daysElapsed - 1] ?? 0) / daysElapsed) * daysInMonth;
}

function buildLargestDayHighlight(
  resolvedMonth: string,
  currentDailyTotals: number[],
  currentDayTransactions: Map<number, TransactionRecord[]>,
): SpendingDayHighlight | null {
  const largestDayEntry = currentDailyTotals.reduce(
    (best, totalForDay, index) =>
      totalForDay > best.total ? { day: index + 1, total: totalForDay } : best,
    { day: 0, total: 0 },
  );

  if (largestDayEntry.total <= 0) {
    return null;
  }

  return {
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
  };
}

function isExpense(row: TransactionRecord): boolean {
  return getCategoryKind(row) === 'expense' && getHomeAmount(row) < 0;
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
  };
}

function getDaysInMonth(monthValue: string): number {
  const [yearRaw, monthRaw] = monthValue.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  if (!(year && month)) {
    return 0;
  }

  return new Date(year, month, 0).getDate();
}

function getPreviousMonthKey(monthValue: string): string | null {
  const [yearRaw, monthRaw] = monthValue.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  if (!(year && month)) {
    return null;
  }

  const previous = new Date(year, month - 2, 1);
  return toMonthKey(previous);
}

function getDayOfMonth(dateValue: string | null | undefined): number | null {
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getDate();
}

function toCumulativeTotals(values: number[]): number[] {
  let runningTotal = 0;
  return values.map((value) => {
    runningTotal += value;
    return runningTotal;
  });
}

function formatDayLabel(monthValue: string, day: number): string {
  const [yearRaw, monthRaw] = monthValue.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  if (!(year && month && day)) {
    return monthValue;
  }

  return new Date(year, month - 1, day).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  });
}

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
