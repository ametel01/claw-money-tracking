import { cn } from '@/lib/utils'
import type { MonthSummary } from '@/types'

interface MonthTabsProps {
  months: MonthSummary[]
  activeMonth: string | null
  onMonthChange: (month: string) => void
}

export function MonthTabs({ months, activeMonth, onMonthChange }: MonthTabsProps) {
  if (months.length === 0) return null

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {months.map((month) => {
        const isActive = month.key === activeMonth
        return (
          <button
            key={month.key}
            type="button"
            onClick={() => onMonthChange(month.key)}
            className={cn(
              'whitespace-nowrap rounded-sm border px-3 py-1 text-[0.65rem] font-semibold tracking-wide transition-colors',
              isActive
                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border-border bg-transparent text-muted-foreground hover:border-muted hover:bg-secondary hover:text-foreground'
            )}
          >
            {month.label} ({month.count})
          </button>
        )
      })}
    </div>
  )
}
