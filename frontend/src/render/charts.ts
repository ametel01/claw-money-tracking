import { clearElement } from '../lib/dom'
import { escapeHtml, formatMoney } from '../lib/format'
import type { LineChartModel, PieSegment } from '../types'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function renderCategoryPie(
  pieElement: HTMLElement,
  legendElement: HTMLElement,
  segments: PieSegment[]
): void {
  if (segments.length === 0) {
    pieElement.style.background = 'conic-gradient(#10161f 0 360deg)'
    legendElement.innerHTML = '<p class="empty-state">No expense data yet.</p>'
    return
  }

  let start = 0
  const gradientParts: string[] = []

  for (const segment of segments) {
    const end = start + segment.pct
    gradientParts.push(`${segment.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`)
    start = end
  }

  pieElement.style.background = `conic-gradient(${gradientParts.join(',')})`

  clearElement(legendElement)
  const fragment = document.createDocumentFragment()

  for (const segment of segments) {
    const row = document.createElement('div')
    row.className = 'legend-item'

    const left = document.createElement('span')
    left.className = 'legend-left'

    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    swatch.style.background = segment.color

    const label = document.createElement('span')
    label.className = 'legend-name'
    label.textContent = segment.name

    const value = document.createElement('span')
    value.className = 'legend-val'
    value.textContent = `${segment.pct.toFixed(1)}%`

    left.append(swatch, label)
    row.append(left, value)
    fragment.append(row)
  }

  legendElement.append(fragment)
}

export function renderLineChart(
  svgElement: SVGSVGElement,
  legendElement: HTMLElement,
  model: LineChartModel
): void {
  if (model.weeks.length === 0 || model.series.length === 0) {
    svgElement.replaceChildren()
    legendElement.innerHTML = '<p class="empty-state">No expense data yet.</p>'
    return
  }

  const width = 900
  const height = 320
  const left = 48
  const right = 12
  const top = 16
  const bottom = 40

  const xCoordinate = (index: number): number => {
    if (model.weeks.length === 1) {
      return left
    }

    return left + (index * (width - left - right)) / (model.weeks.length - 1)
  }

  const yCoordinate = (value: number): number =>
    top + (height - top - bottom) * (1 - value / model.maxY)

  svgElement.replaceChildren()

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (model.maxY * tick) / 4
    const y = yCoordinate(value)

    svgElement.appendChild(
      createSvgNode('line', {
        x1: `${left}`,
        y1: `${y}`,
        x2: `${width - right}`,
        y2: `${y}`,
        stroke: '#182030',
        'stroke-width': '1',
      })
    )

    const text = createSvgNode('text', {
      x: `${left - 8}`,
      y: `${y + 4}`,
      'text-anchor': 'end',
      'font-size': '10',
      fill: '#2e4258',
    })
    text.textContent = Math.round(value).toLocaleString()
    svgElement.appendChild(text)
  }

  svgElement.appendChild(
    createSvgNode('line', {
      x1: `${left}`,
      y1: `${height - bottom}`,
      x2: `${width - right}`,
      y2: `${height - bottom}`,
      stroke: '#182030',
      'stroke-width': '1',
    })
  )

  model.labels.forEach((label, index) => {
    const text = createSvgNode('text', {
      x: `${xCoordinate(index)}`,
      y: `${height - 14}`,
      'text-anchor': 'middle',
      'font-size': '10',
      fill: '#2e4258',
    })
    text.textContent = label
    svgElement.appendChild(text)
  })

  for (const series of model.series) {
    const points = series.values
      .map((value, index) => `${xCoordinate(index)},${yCoordinate(value)}`)
      .join(' ')

    svgElement.appendChild(
      createSvgNode('polyline', {
        fill: 'none',
        stroke: series.color,
        'stroke-width': '2.2',
        points,
      })
    )
  }

  legendElement.innerHTML = model.series
    .map(
      (series) =>
        `<div class="legend-item">
          <span class="legend-left">
            <span class="swatch" style="background:${series.color}"></span>
            <span class="legend-name">${escapeHtml(series.category)}</span>
          </span>
          <span class="legend-val">${escapeHtml(formatMoney(series.total))}</span>
        </div>`
    )
    .join('')
}

function createSvgNode(
  tagName: string,
  attributes: Record<string, string>
): SVGElement | SVGTextElement {
  const node = document.createElementNS(SVG_NS, tagName)

  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value)
  }

  return node
}
