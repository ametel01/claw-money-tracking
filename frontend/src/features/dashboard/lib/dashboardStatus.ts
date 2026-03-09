import { monthLabel } from '@/lib/format';

export type LoadTone = 'loading' | 'success' | 'error';

export interface DashboardLoadStatus {
  tone: LoadTone;
  message: string;
}

const LOAD_STATUS_CLASSNAME: Record<LoadTone, string> = {
  error: 'text-xs text-destructive sm:text-right',
  loading: 'text-xs text-muted-foreground sm:text-right',
  success: 'text-xs text-[var(--color-success)] sm:text-right',
};

export function getLoadStatusClassName(tone: LoadTone): string {
  return LOAD_STATUS_CLASSNAME[tone];
}

export function buildDashboardLoadingMessage(month?: string | null): string {
  if (month) {
    return `Loading ${monthLabel(month)}…`;
  }

  return 'Loading dashboard…';
}

export function buildDashboardLoadedMessage(
  month: string | null,
  transactionCount: number,
): string {
  return `Loaded ${transactionCount} transactions for ${month ? monthLabel(month) : 'the ledger'}.`;
}
