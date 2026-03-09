import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney } from '@/lib/format'
import type { OverviewResponse } from '@/types'

interface KpiCardsProps {
  overview: OverviewResponse | null
  loading?: boolean
}

const ACCENT_CLASSES = [
  'border-l-[color:var(--color-success)]',
  'border-l-destructive',
  'border-l-primary',
  'border-l-[color:oklch(0.60_0.20_245)]',
] as const

export function KpiCards({ overview, loading }: KpiCardsProps) {
  const items: Array<[string, string]> = overview
    ? [
        ['Income', formatMoney(overview.income)],
        ['Expenses', formatMoney(overview.expenses)],
        ['Net', formatMoney(overview.net)],
        ['Transactions', String(overview.txCount ?? 0)],
      ]
    : [
        ['Income', ''],
        ['Expenses', ''],
        ['Net', ''],
        ['Transactions', ''],
      ]

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {items.map(([label, value], index) => (
        <Card
          key={label}
          className={`border border-border border-l-3 bg-secondary ${ACCENT_CLASSES[index] ?? ''}`}
        >
          <CardContent className="flex flex-col gap-2 p-4">
            <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {label}
            </p>
            {loading || !overview ? (
              <Skeleton className="h-6 w-24" />
            ) : (
              <p className="text-lg font-bold tabular-nums tracking-tight text-foreground">
                {value}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
