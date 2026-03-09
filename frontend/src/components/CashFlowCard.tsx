import { formatMoney, monthLabel } from '@/lib/format';
import type { CashFlowPoint } from '@/types';

interface CashFlowCardProps {
  points: CashFlowPoint[];
  activeMonth: string | null;
}

export function CashFlowCard({ points, activeMonth }: CashFlowCardProps) {
  const activePoint =
    (activeMonth ? points.find((point) => point.month === activeMonth) : null) ?? points[0] ?? null;

  if (!activePoint) {
    return <p className="text-xs text-muted-foreground">No cash-flow history available yet.</p>;
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-xs font-semibold text-foreground">{monthLabel(activePoint.month)}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">
          {formatMoney(activePoint.net, 'PHP')}
        </p>
        <p className="text-xs text-muted-foreground">Net cash flow for the selected month.</p>
      </div>

      <div className="grid gap-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Income</span>
          <span className="font-semibold tabular-nums text-[var(--color-success)]">
            {formatMoney(activePoint.income, 'PHP')}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Expenses</span>
          <span className="font-semibold tabular-nums text-[var(--color-danger)]">
            {formatMoney(activePoint.expenses, 'PHP')}
          </span>
        </div>
      </div>

      <div className="grid gap-1.5">
        {points.slice(0, 4).map((point) => (
          <div key={point.month} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{monthLabel(point.month)}</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatMoney(point.net, 'PHP')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
