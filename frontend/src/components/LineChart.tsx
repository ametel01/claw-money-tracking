import { Badge } from '@/components/ui/badge'
import { formatMoney } from '@/lib/format'
import type { LineChartModel } from '@/types'

interface LineChartProps {
  model: LineChartModel
}

const WIDTH = 900
const HEIGHT = 320
const MARGIN = { left: 60, right: 20, top: 24, bottom: 42 }
const CURRENT_COLOR = 'oklch(0.74 0.19 110)'
const CURRENT_FILL = 'oklch(0.74 0.19 110 / 0.12)'
const COMPARISON_COLOR = 'oklch(0.62 0.05 245)'
const PROJECTION_COLOR = 'oklch(0.82 0.06 110)'

function xCoord(index: number, pointCount: number): number {
  if (pointCount <= 1) return MARGIN.left
  return MARGIN.left + (index * (WIDTH - MARGIN.left - MARGIN.right)) / (pointCount - 1)
}

function yCoord(value: number, maxY: number): number {
  return MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) * (1 - value / maxY)
}

function buildPolylinePoints(values: number[], maxY: number, pointCount: number): string {
  return values
    .map((value, index) => `${xCoord(index, pointCount)},${yCoord(value, maxY)}`)
    .join(' ')
}

function buildAreaPoints(values: number[], maxY: number, pointCount: number): string {
  const topEdge = buildPolylinePoints(values, maxY, pointCount)
  const baseline = HEIGHT - MARGIN.bottom
  return `${MARGIN.left},${baseline} ${topEdge} ${xCoord(pointCount - 1, pointCount)},${baseline}`
}

function formatAxisMoney(value: number): string {
  if (value === 0) return '0'

  const compact = new Intl.NumberFormat('en-PH', {
    maximumFractionDigits: value >= 10_000 ? 0 : 1,
    notation: 'compact',
  }).format(value)

  return `P${compact}`
}

function formatDelta(value: number): string {
  return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`
}

export function LineChart({ model }: LineChartProps) {
  if (!model.monthKey || model.points.length === 0) {
    return <p className="text-xs text-muted-foreground">No expense data yet.</p>
  }

  const gridLineColor = 'oklch(0.16 0.02 245)'
  const gridTextColor = 'oklch(0.40 0.03 245)'
  const chartTitle = `${model.monthLabel} spending pace`
  const currentValues = model.points.map((point) => point.current)
  const comparisonValues = model.points.map((point) => point.previous ?? 0)
  const comparisonBasis = model.isCurrentMonth ? model.comparisonToDate : model.comparisonTotal
  const comparisonDelta = comparisonBasis == null ? null : model.total - comparisonBasis
  const deltaLabel = model.isCurrentMonth
    ? `vs ${model.comparisonMonthLabel ?? 'previous month'} pace`
    : `vs ${model.comparisonMonthLabel ?? 'previous month'}`
  const xTicks = model.points.filter(
    (point) =>
      point.day === 1 ||
      point.day === model.daysInMonth ||
      point.day % 7 === 0 ||
      point.day === model.daysElapsed
  )
  const highlightPoint =
    model.largestDay && model.points.find((point) => point.day === model.largestDay?.day)
  const projectionStartIndex = Math.max(0, model.daysElapsed - 1)
  const projectionStartPoint = model.points[projectionStartIndex]
  const projectionEndIndex = model.points.length - 1

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-secondary/60 p-3">
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {model.isCurrentMonth ? 'Spent so far' : 'Month total'}
          </p>
          <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
            {formatMoney(model.total)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Day {model.daysElapsed} of {model.daysInMonth} in {model.monthLabel}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-secondary/60 p-3">
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {model.projectedTotal != null ? 'Projected month-end' : deltaLabel}
          </p>
          <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
            {model.projectedTotal != null
              ? formatMoney(model.projectedTotal)
              : comparisonDelta != null
                ? formatDelta(comparisonDelta)
                : 'No comparison'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {model.projectedTotal != null
              ? model.comparisonMonthLabel
                ? `${formatDelta(comparisonDelta ?? 0)} against ${model.comparisonMonthLabel} pace`
                : 'Projection based on the current daily average.'
              : model.comparisonMonthLabel
                ? `${formatMoney(model.comparisonTotal ?? model.comparisonToDate ?? 0)} in ${model.comparisonMonthLabel}`
                : 'Import another month to unlock comparisons.'}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-secondary/60 p-3">
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Largest spend day
          </p>
          <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
            {model.largestDay ? formatMoney(model.largestDay.total) : 'No spikes'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {model.largestDay ? model.largestDay.label : 'No expense activity recorded.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{model.monthLabel}</Badge>
        {model.comparisonMonthLabel && (
          <Badge variant="outline">{model.comparisonMonthLabel}</Badge>
        )}
        {model.projectedTotal != null && <Badge variant="outline">Projection</Badge>}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-[240px] w-full rounded-sm border border-border bg-[var(--color-surface-muted)]"
      >
        <title>{chartTitle}</title>

        {[0, 1, 2, 3, 4].map((tick) => {
          const value = (model.maxY * tick) / 4
          const y = yCoord(value, model.maxY)
          return (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                y1={y}
                x2={WIDTH - MARGIN.right}
                y2={y}
                stroke={gridLineColor}
                strokeWidth="1"
              />
              <text
                x={MARGIN.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill={gridTextColor}
              >
                {formatAxisMoney(value)}
              </text>
            </g>
          )
        })}

        <line
          x1={MARGIN.left}
          y1={HEIGHT - MARGIN.bottom}
          x2={WIDTH - MARGIN.right}
          y2={HEIGHT - MARGIN.bottom}
          stroke={gridLineColor}
          strokeWidth="1"
        />

        {xTicks.map((point) => (
          <text
            key={point.day}
            x={xCoord(point.day - 1, model.points.length)}
            y={HEIGHT - 14}
            textAnchor="middle"
            fontSize="10"
            fill={gridTextColor}
          >
            {point.label}
          </text>
        ))}

        <polygon
          points={buildAreaPoints(currentValues, model.maxY, model.points.length)}
          fill={CURRENT_FILL}
        />

        {model.comparisonMonthLabel && (
          <polyline
            fill="none"
            stroke={COMPARISON_COLOR}
            strokeDasharray="5 5"
            strokeWidth="2"
            points={buildPolylinePoints(comparisonValues, model.maxY, model.points.length)}
          />
        )}

        <polyline
          fill="none"
          stroke={CURRENT_COLOR}
          strokeWidth="3"
          points={buildPolylinePoints(currentValues, model.maxY, model.points.length)}
        />

        {model.projectedTotal != null && projectionStartPoint && (
          <line
            x1={xCoord(projectionStartIndex, model.points.length)}
            y1={yCoord(projectionStartPoint.current, model.maxY)}
            x2={xCoord(projectionEndIndex, model.points.length)}
            y2={yCoord(model.projectedTotal, model.maxY)}
            stroke={PROJECTION_COLOR}
            strokeDasharray="3 5"
            strokeWidth="2"
          />
        )}

        {highlightPoint && model.largestDay && (
          <g>
            <circle
              cx={xCoord(highlightPoint.day - 1, model.points.length)}
              cy={yCoord(highlightPoint.current, model.maxY)}
              r="4"
              fill={CURRENT_COLOR}
              stroke="oklch(0.10 0.01 245)"
              strokeWidth="1.5"
            />
            <text
              x={xCoord(highlightPoint.day - 1, model.points.length)}
              y={yCoord(highlightPoint.current, model.maxY) - 12}
              textAnchor="middle"
              fontSize="10"
              fill={gridTextColor}
            >
              {model.largestDay.label}
            </text>
          </g>
        )}
      </svg>

      {model.largestDay && (
        <div className="grid gap-2 rounded-lg border border-border bg-secondary/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Largest day breakdown
              </p>
              <p className="text-sm font-medium text-foreground">
                {model.largestDay.label} accounted for {formatMoney(model.largestDay.total)}.
              </p>
            </div>
            <Badge variant="outline">{model.largestDay.transactions.length} drivers</Badge>
          </div>

          <div className="grid gap-2">
            {model.largestDay.transactions.map((transaction) => (
              <div
                key={transaction.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {transaction.description}
                  </p>
                  <p className="text-[0.68rem] text-muted-foreground">{transaction.category}</p>
                </div>
                <p className="text-xs font-semibold tabular-nums text-foreground">
                  {formatMoney(transaction.amount)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
