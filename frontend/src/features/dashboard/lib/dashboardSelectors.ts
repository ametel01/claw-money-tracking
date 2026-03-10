import { currentMonthKey, monthLabel } from '@/lib/format';
import type { BudgetPeriodRecord, ImportBatchDetail, MonthSummary } from '@/types';

export function ensureMonthSummary(
  months: MonthSummary[],
  month: string,
): MonthSummary[] {
  if (months.some((entry) => entry.key === month)) {
    return months;
  }

  return [...months, { key: month, label: monthLabel(month), count: 0 }].sort((left, right) =>
    right.key.localeCompare(left.key),
  );
}

export function resolveSelectedMonth(
  months: MonthSummary[],
  requestedMonth: string | null,
  fallbackMonth = currentMonthKey(),
): string | null {
  if (requestedMonth && months.some((month) => month.key === requestedMonth)) {
    return requestedMonth;
  }

  if (months.some((month) => month.key === fallbackMonth)) {
    return fallbackMonth;
  }

  return months[0]?.key ?? null;
}

export function selectActiveBudgetPeriod(
  budgetPeriods: BudgetPeriodRecord[],
  activeMonth: string | null,
): BudgetPeriodRecord | null {
  return budgetPeriods.find((period) => period.month === activeMonth) ?? null;
}

export function selectLatestBatchSummary(batch: ImportBatchDetail | null): string | undefined {
  if (!batch) {
    return undefined;
  }

  return `${batch.counts.needs_review} need review, ${batch.counts.duplicate} duplicates in the latest batch.`;
}
