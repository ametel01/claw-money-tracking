import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/format';
import type { LineChartModel, SpendingDayHighlight } from '@/types';

interface LineChartProps {
  model: LineChartModel;
}

const WIDTH = 900;
const HEIGHT = 320;
const MARGIN = { left: 60, right: 20, top: 24, bottom: 42 };
const CURRENT_COLOR = 'oklch(0.74 0.19 110)';
const CURRENT_FILL = 'oklch(0.74 0.19 110 / 0.12)';
const COMPARISON_COLOR = 'oklch(0.62 0.05 245)';
const PROJECTION_COLOR = 'oklch(0.82 0.06 110)';

function xCoord(index: number, pointCount: number): number {
  if (pointCount <= 1) return MARGIN.left;
  return MARGIN.left + (index * (WIDTH - MARGIN.left - MARGIN.right)) / (pointCount - 1);
}

function yCoord(value: number, maxY: number): number {
  return MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) * (1 - value / maxY);
}

function buildPolylinePoints(values: number[], maxY: number, pointCount: number): string {
  return values
    .map((value, index) => `${xCoord(index, pointCount)},${yCoord(value, maxY)}`)
    .join(' ');
}

function buildAreaPoints(values: number[], maxY: number, pointCount: number): string {
  const topEdge = buildPolylinePoints(values, maxY, pointCount);
  const baseline = HEIGHT - MARGIN.bottom;
  return `${MARGIN.left},${baseline} ${topEdge} ${xCoord(pointCount - 1, pointCount)},${baseline}`;
}

function formatAxisMoney(value: number): string {
  if (value === 0) return '0';

  const compact = new Intl.NumberFormat('en-PH', {
    maximumFractionDigits: value >= 10_000 ? 0 : 1,
    notation: 'compact',
  }).format(value);

  return `P${compact}`;
}

function formatDelta(value: number): string {
  return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
}

interface ProjectionSummary {
  label: string;
  value: string;
  detail: string;
}

export function LineChart({ model }: LineChartProps) {
  if (!model.monthKey || model.points.length === 0) {
    return <p className="text-xs text-muted-foreground">No expense data yet.</p>;
  }

  const spentLabel = model.isCurrentMonth ? 'Spent so far' : 'Month total';
  const projectionSummary = getProjectionSummary(model);
  const largestDayValue = model.largestDay ? formatMoney(model.largestDay.total) : 'No spikes';
  const largestDayDetail = model.largestDay?.label ?? 'No expense activity recorded.';

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-border bg-secondary/60 p-3">
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {spentLabel}
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
            {projectionSummary.label}
          </p>
          <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
            {projectionSummary.value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{projectionSummary.detail}</p>
        </div>

        <div className="rounded-lg border border-border bg-secondary/60 p-3">
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Largest spend day
          </p>
          <p className="mt-2 text-lg font-bold tabular-nums text-foreground">{largestDayValue}</p>
          <p className="mt-1 text-xs text-muted-foreground">{largestDayDetail}</p>
        </div>
      </div>

      <ChartBadges model={model} />

      <ChartSvg model={model} />
      <LargestDayBreakdown largestDay={model.largestDay} />
    </div>
  );
}

function getProjectionSummary(model: LineChartModel): ProjectionSummary {
  if (model.projectedTotal != null) {
    return getProjectedSummary(model);
  }

  return getComparisonSummary(model);
}

function getProjectedSummary(model: LineChartModel): ProjectionSummary {
  const comparisonDelta = getComparisonDelta(model) ?? 0;
  const detail = model.comparisonMonthLabel
    ? `${formatDelta(comparisonDelta)} against ${model.comparisonMonthLabel} pace`
    : 'Projection based on the current daily average.';

  return {
    label: 'Projected month-end',
    value: formatMoney(model.projectedTotal ?? 0),
    detail,
  };
}

function getComparisonSummary(model: LineChartModel): ProjectionSummary {
  const comparisonDelta = getComparisonDelta(model);

  return {
    label: getComparisonLabel(model),
    value: comparisonDelta != null ? formatDelta(comparisonDelta) : 'No comparison',
    detail: getComparisonDetail(model),
  };
}

function getComparisonDelta(model: LineChartModel): number | null {
  const comparisonBasis = model.isCurrentMonth ? model.comparisonToDate : model.comparisonTotal;
  if (comparisonBasis == null) {
    return null;
  }

  return model.total - comparisonBasis;
}

function getComparisonLabel(model: LineChartModel): string {
  return model.isCurrentMonth
    ? `vs ${model.comparisonMonthLabel ?? 'previous month'} pace`
    : `vs ${model.comparisonMonthLabel ?? 'previous month'}`;
}

function getComparisonDetail(model: LineChartModel): string {
  if (!model.comparisonMonthLabel) {
    return 'Import another month to unlock comparisons.';
  }

  return `${formatMoney(model.comparisonTotal ?? model.comparisonToDate ?? 0)} in ${model.comparisonMonthLabel}`;
}

function ChartBadges({ model }: LineChartProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">{model.monthLabel}</Badge>
      {model.comparisonMonthLabel ? (
        <Badge variant="outline">{model.comparisonMonthLabel}</Badge>
      ) : null}
      {model.projectedTotal != null ? <Badge variant="outline">Projection</Badge> : null}
    </div>
  );
}

function ChartSvg({ model }: LineChartProps) {
  const gridLineColor = 'oklch(0.16 0.02 245)';
  const gridTextColor = 'oklch(0.40 0.03 245)';
  const chartTitle = `${model.monthLabel} spending pace`;
  const currentValues = model.points.map((point) => point.current);
  const comparisonValues = model.points.map((point) => point.previous ?? 0);
  const xTicks = getXTicks(model);
  const highlightPoint = getHighlightPoint(model);
  const projectionLine = getProjectionLine(model);

  return (
    <div className="grid gap-2">
      <p className="text-[0.68rem] text-muted-foreground sm:hidden">Swipe to inspect daily pacing.</p>
      <div className="overflow-x-auto pb-1 [scrollbar-width:thin]">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-auto min-w-[720px] w-[720px] rounded-sm border border-border bg-[var(--color-surface-muted)] sm:min-w-0 sm:w-full"
        >
          <title>{chartTitle}</title>

          {[0, 1, 2, 3, 4].map((tick) => {
            const value = (model.maxY * tick) / 4;
            const y = yCoord(value, model.maxY);
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
            );
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

          {model.comparisonMonthLabel ? (
            <polyline
              fill="none"
              stroke={COMPARISON_COLOR}
              strokeDasharray="5 5"
              strokeWidth="2"
              points={buildPolylinePoints(comparisonValues, model.maxY, model.points.length)}
            />
          ) : null}

          <polyline
            fill="none"
            stroke={CURRENT_COLOR}
            strokeWidth="3"
            points={buildPolylinePoints(currentValues, model.maxY, model.points.length)}
          />

          {projectionLine ? (
            <line
              x1={xCoord(projectionLine.startIndex, model.points.length)}
              y1={yCoord(projectionLine.startValue, model.maxY)}
              x2={xCoord(projectionLine.endIndex, model.points.length)}
              y2={yCoord(projectionLine.endValue, model.maxY)}
              stroke={PROJECTION_COLOR}
              strokeDasharray="3 5"
              strokeWidth="2"
            />
          ) : null}

          {highlightPoint && model.largestDay ? (
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
          ) : null}
        </svg>
      </div>
    </div>
  );
}

function getXTicks(model: LineChartModel) {
  return model.points.filter(
    (point) =>
      point.day === 1 ||
      point.day === model.daysInMonth ||
      point.day % 7 === 0 ||
      point.day === model.daysElapsed,
  );
}

function getHighlightPoint(model: LineChartModel) {
  if (!model.largestDay) {
    return null;
  }

  return model.points.find((point) => point.day === model.largestDay?.day) ?? null;
}

function getProjectionLine(model: LineChartModel) {
  if (model.projectedTotal == null) {
    return null;
  }

  const startIndex = Math.max(0, model.daysElapsed - 1);
  const startPoint = model.points[startIndex];
  if (!startPoint) {
    return null;
  }

  return {
    startIndex,
    startValue: startPoint.current,
    endIndex: model.points.length - 1,
    endValue: model.projectedTotal,
  };
}

function LargestDayBreakdown({ largestDay }: { largestDay: SpendingDayHighlight | null }) {
  if (!largestDay) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Largest day breakdown
          </p>
          <p className="text-sm font-medium text-foreground">
            {largestDay.label} accounted for {formatMoney(largestDay.total)}.
          </p>
        </div>
        <Badge variant="outline">{largestDay.transactions.length} drivers</Badge>
      </div>

      <div className="grid gap-2">
        {largestDay.transactions.map((transaction) => (
          <div
            key={transaction.id}
            className="grid gap-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground sm:truncate">
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
  );
}
