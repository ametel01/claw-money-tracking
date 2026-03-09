import { formatMoney, monthLabel } from '@/lib/format'
import type { BudgetPeriodRecord } from '@/types'

interface BudgetProgressCardProps {
  period: BudgetPeriodRecord | null
}

export function BudgetProgressCard({ period }: BudgetProgressCardProps) {
  if (!period) {
    return <p className="text-xs text-muted-foreground">No budget configured for this month.</p>
  }

  if (period.targets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {monthLabel(period.month)} has no category targets yet.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      {period.targets.map((target) => {
        const progress =
          target.targetAmount > 0
            ? Math.min((target.actualAmount / target.targetAmount) * 100, 100)
            : 0
        const overBudget = target.actualAmount > target.targetAmount

        return (
          <div key={target.id} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{target.categoryName}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatMoney(target.actualAmount, period.currency)} /{' '}
                {formatMoney(target.targetAmount, period.currency)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={overBudget ? 'h-full bg-[var(--color-danger)]' : 'h-full bg-primary'}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[0.65rem] text-muted-foreground">
              {overBudget
                ? `${formatMoney(Math.abs(target.remainingAmount), period.currency)} over target`
                : `${formatMoney(target.remainingAmount, period.currency)} remaining`}
            </p>
          </div>
        )
      })}
    </div>
  )
}
