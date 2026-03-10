import { formatMoney } from '@/lib/format';
import type { RecurringInsights } from '@/types';

interface RecurringPreviewCardProps {
  insights: RecurringInsights | null;
}

export function RecurringPreviewCard({ insights }: RecurringPreviewCardProps) {
  if (!insights || insights.nextCharges.length === 0) {
    return (
      <div className="grid gap-2">
        <p className="text-xs font-semibold text-foreground">No recurring series yet.</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Recurring detection has not found any stable monthly or annual series yet.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold text-foreground">
        {formatMoney(insights.projectedRemainingFixedSpend, 'PHP')} projected fixed spend
      </p>
      <div className="grid gap-1.5">
        {insights.nextCharges.slice(0, 3).map((series) => (
          <div
            key={series.id}
            className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <span className="text-foreground sm:truncate">
              {series.merchantName} · {series.cadence} · {series.occurrenceCount} hits
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatMoney(series.averageAmount, 'PHP')}
            </span>
          </div>
        ))}
      </div>
      <div className="grid gap-1">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
          Likely subscriptions
        </p>
        {insights.likelySubscriptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No likely subscriptions detected yet.</p>
        ) : (
          insights.likelySubscriptions.slice(0, 3).map((series) => (
            <p key={`subscription-${series.id}`} className="text-xs text-muted-foreground">
              {series.merchantName} · next {series.nextExpectedDate || 'unknown'}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
