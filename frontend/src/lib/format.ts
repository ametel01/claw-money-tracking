import type { CurrencyViewMode, TransactionRecord } from '../types';

const moneyFormatterCache = new Map<string, Intl.NumberFormat>();

export function monthKey(dateValue: string | null | undefined): string {
  return String(dateValue ?? '').slice(0, 7);
}

export function currentMonthKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function monthLabel(monthValue: string): string {
  const [yearRaw, monthRaw] = monthValue.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  if (!(year && month)) {
    return monthValue;
  }

  return new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
    month: 'short',
    year: 'numeric',
  });
}

export function weekStart(dateValue: string | null | undefined): string | null {
  if (!dateValue) {
    return null;
  }

  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const dayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayOffset);
  return date.toISOString().slice(0, 10);
}

export function weekLabel(weekStartValue: string): string {
  const start = new Date(`${weekStartValue}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return weekStartValue;
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  return `${start.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  })} - ${end.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  })}`;
}

export function formatMoney(value: number | null | undefined, currency = 'PHP'): string {
  const resolvedCurrency = currency || 'PHP';
  const amount = Number(value ?? 0);
  const cacheKey = `${resolvedCurrency}`;

  let formatter = moneyFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: resolvedCurrency,
      maximumFractionDigits: resolvedCurrency === 'JPY' ? 0 : 2,
    });
    moneyFormatterCache.set(cacheKey, formatter);
  }

  return formatter.format(amount);
}

export function getHomeAmount(row: TransactionRecord): number {
  return Number(row.amount_home ?? row.amount ?? 0);
}

export function getNativeAmount(row: TransactionRecord): number {
  return Number(row.amount_original ?? row.amount ?? 0);
}

export function getCurrency(row: TransactionRecord): string {
  return row.currency ?? row.account_currency ?? 'PHP';
}

export function getCategoryName(row: TransactionRecord): string {
  return row.category_name || 'Uncategorized';
}

export function getCategoryKind(row: TransactionRecord): string {
  return row.category_kind || 'expense';
}

export function formatTransactionAmount(
  row: TransactionRecord,
  viewMode: CurrencyViewMode,
): string {
  const homeAmount = getHomeAmount(row);
  const nativeAmount = getNativeAmount(row);
  const currency = getCurrency(row);

  if (getCategoryKind(row) === 'transfer') {
    return `↔ ${formatTransferAmount(homeAmount, nativeAmount, currency, viewMode)}`;
  }

  if (viewMode === 'native') {
    return formatMoney(nativeAmount, currency);
  }

  if (viewMode === 'both') {
    return `${formatMoney(homeAmount, 'PHP')} · ${formatMoney(nativeAmount, currency)}`;
  }

  return formatMoney(homeAmount, 'PHP');
}

function formatTransferAmount(
  homeAmount: number,
  nativeAmount: number,
  currency: string,
  viewMode: CurrencyViewMode,
): string {
  if (viewMode === 'native') {
    return formatMoney(Math.abs(nativeAmount), currency);
  }

  if (viewMode === 'both') {
    return `${formatMoney(Math.abs(homeAmount), 'PHP')} · ${formatMoney(
      Math.abs(nativeAmount),
      currency,
    )}`;
  }

  return formatMoney(Math.abs(homeAmount), 'PHP');
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}
