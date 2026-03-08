import { clearElement } from '../lib/dom'
import { formatMoney } from '../lib/format'
import type { OverviewResponse } from '../types'

export function renderKpis(container: HTMLElement, overview: OverviewResponse): void {
  clearElement(container)

  const items: Array<[string, string]> = [
    ['Income', formatMoney(overview.income)],
    ['Expenses', formatMoney(overview.expenses)],
    ['Net', formatMoney(overview.net)],
    ['Transactions', String(overview.txCount ?? 0)],
  ]

  const fragment = document.createDocumentFragment()

  for (const [label, value] of items) {
    const card = document.createElement('article')
    card.className = 'card'

    const labelNode = document.createElement('div')
    labelNode.className = 'card__label'
    labelNode.textContent = label

    const valueNode = document.createElement('div')
    valueNode.className = 'card__value'
    valueNode.textContent = value

    card.append(labelNode, valueNode)
    fragment.append(card)
  }

  container.append(fragment)
}
