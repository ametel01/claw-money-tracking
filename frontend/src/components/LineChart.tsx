import { formatMoney } from '@/lib/format'
import type { LineChartModel } from '@/types'

interface LineChartProps {
  model: LineChartModel
}

const WIDTH = 900
const HEIGHT = 320
const MARGIN = { left: 48, right: 12, top: 16, bottom: 40 }

function xCoord(index: number, weekCount: number): number {
  if (weekCount === 1) return MARGIN.left
  return MARGIN.left + (index * (WIDTH - MARGIN.left - MARGIN.right)) / (weekCount - 1)
}

function yCoord(value: number, maxY: number): number {
  return MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) * (1 - value / maxY)
}

export function LineChart({ model }: LineChartProps) {
  if (model.weeks.length === 0 || model.series.length === 0) {
    return <p className="text-xs text-muted-foreground">No expense data yet.</p>
  }

  const gridLineColor = 'oklch(0.16 0.02 245)'
  const gridTextColor = 'oklch(0.28 0.03 245)'
  const chartTitle = 'Weekly category spending trend'

  return (
    <div className="grid gap-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="w-full h-[220px] rounded-sm border border-border bg-[var(--color-surface-muted)]"
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
                {Math.round(value).toLocaleString()}
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

        {model.labels.map((label, index) => (
          <text
            key={label}
            x={xCoord(index, model.weeks.length)}
            y={HEIGHT - 14}
            textAnchor="middle"
            fontSize="10"
            fill={gridTextColor}
          >
            {label}
          </text>
        ))}

        {model.series.map((series) => (
          <polyline
            key={series.category}
            fill="none"
            stroke={series.color}
            strokeWidth="2.2"
            points={series.values
              .map(
                (value, index) =>
                  `${xCoord(index, model.weeks.length)},${yCoord(value, model.maxY)}`
              )
              .join(' ')}
          />
        ))}
      </svg>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-1.5">
        {model.series.map((series) => (
          <div
            key={series.category}
            className="flex items-center justify-between gap-3 min-w-0 text-xs"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="size-1.5 shrink-0 rounded-[1px]"
                style={{ background: series.color }}
              />
              <span className="truncate text-foreground">{series.category}</span>
            </span>
            <span className="tabular-nums whitespace-nowrap text-muted-foreground">
              {formatMoney(series.total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
