import { formatMoney, monthLabel } from '@/lib/format';
import type { MerchantLeaderboardItem } from '@/types';

interface MerchantLeaderboardCardProps {
  merchants: MerchantLeaderboardItem[];
  activeMonth: string | null;
}

export function MerchantLeaderboardCard({ merchants, activeMonth }: MerchantLeaderboardCardProps) {
  if (merchants.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No merchant trends available for {activeMonth ? monthLabel(activeMonth) : 'this view'}.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {merchants.slice(0, 5).map((merchant, index) => (
        <div
          key={`${merchant.merchantId ?? merchant.merchantName}-${index}`}
          className="grid gap-1.5 rounded-sm border border-border/70 px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
        >
          <div className="flex items-center gap-2 sm:contents">
            <span className="text-[0.65rem] font-semibold text-muted-foreground">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground sm:truncate">{merchant.merchantName}</p>
              <p className="text-[0.65rem] text-muted-foreground">
                {merchant.transactionCount} transaction
                {merchant.transactionCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold tabular-nums text-foreground sm:text-right">
            {formatMoney(merchant.total, 'PHP')}
          </span>
        </div>
      ))}
    </div>
  );
}
