import type { BudgetPeriodRecord, ImportBatchDetail, MonthSummary } from '@/types';

export function resolveSelectedMonth(
  months: MonthSummary[],
  requestedMonth: string | null,
): string | null {
  if (requestedMonth && months.some((month) => month.key === requestedMonth)) {
    return requestedMonth;
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
