import { clearElement } from '../lib/dom'
import {
  formatTransactionAmount,
  getCategoryKind,
  getCategoryName,
  getCurrency,
  getHomeAmount,
  monthKey,
} from '../lib/format'
import type { CurrencyViewMode, MonthSummary, TransactionRecord } from '../types'

export function renderMonthTabs(
  container: HTMLElement,
  months: MonthSummary[],
  activeMonth: string | null
): void {
  clearElement(container)

  if (months.length === 0) {
    container.hidden = true
    return
  }

  container.hidden = false
  const fragment = document.createDocumentFragment()

  for (const month of months) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = month.key === activeMonth ? 'tab-btn active' : 'tab-btn'
    button.dataset.month = month.key
    button.textContent = `${month.label} (${month.count})`
    fragment.append(button)
  }

  container.append(fragment)
}

export function renderTransactions(
  container: HTMLElement,
  rows: TransactionRecord[],
  activeMonth: string | null,
  viewMode: CurrencyViewMode
): void {
  clearElement(container)

  const visibleRows = activeMonth
    ? rows.filter((row) => monthKey(row.tx_date) === activeMonth)
    : rows

  if (visibleRows.length === 0) {
    const emptyState = document.createElement('p')
    emptyState.className = 'empty-state'
    emptyState.textContent = 'No transactions available for this selection.'
    container.append(emptyState)
    return
  }

  const fragment = document.createDocumentFragment()

  for (const row of visibleRows) {
    const item = document.createElement('article')
    item.className = 'tx'

    const meta = document.createElement('div')
    meta.className = 'tx__meta'

    const description = document.createElement('div')
    description.className = 'tx__desc'
    description.textContent = row.description || '(no description)'

    const summary = document.createElement('div')
    summary.className = 'tx__sub'
    summary.textContent = [
      row.tx_date,
      row.account_name || 'Unknown account',
      `(${getCurrency(row)})`,
      getCategoryName(row),
    ].join(' • ')

    const amount = document.createElement('div')
    amount.className = `tx__amt ${resolveAmountClass(row)}`
    amount.textContent = formatTransactionAmount(row, viewMode)

    meta.append(description, summary)
    item.append(meta, amount)
    fragment.append(item)
  }

  container.append(fragment)
}

function resolveAmountClass(row: TransactionRecord): string {
  const categoryKind = getCategoryKind(row)
  if (categoryKind === 'transfer') {
    return 'neutral'
  }

  return getHomeAmount(row) < 0 ? 'expense' : 'income'
}
