import { Button } from '@/components/ui/button';
import { TransactionCategorizationPanel } from '@/features/categorization/components/TransactionCategorizationPanel';
import { useTransactionCategorization } from '@/features/categorization/hooks/useTransactionCategorization';
import {
  formatTransactionAmount,
  getCategoryKind,
  getCategoryName,
  getCurrency,
  getHomeAmount,
  monthKey,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CurrencyViewMode, TransactionRecord } from '@/types';
import { useState } from 'react';

interface TransactionListProps {
  transactions: TransactionRecord[];
  activeMonth: string | null;
  viewMode: CurrencyViewMode;
  onRuleCreated: () => Promise<void>;
}

function resolveAmountClass(row: TransactionRecord): string {
  if (getCategoryKind(row) === 'transfer') return 'text-muted-foreground';
  return getHomeAmount(row) < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]';
}

export function TransactionList({
  transactions,
  activeMonth,
  viewMode,
  onRuleCreated,
}: TransactionListProps) {
  const [expandedTransactionId, setExpandedTransactionId] = useState<number | null>(null);
  const categorization = useTransactionCategorization({ onRuleCreated });
  const visible = activeMonth
    ? transactions.filter((row) => monthKey(row.tx_date) === activeMonth)
    : transactions;

  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No transactions available for this selection.</p>
    );
  }

  return (
    <div className="grid">
      {visible.map((row) => (
        <article
          key={row.id}
          className="grid gap-3 border-b border-border py-2.5 last:border-b-0"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <div className="min-w-0">
              <p className="truncate text-[0.78rem] font-medium text-foreground">
                {row.description || '(no description)'}
              </p>
              <p className="mt-0.5 text-[0.66rem] leading-relaxed text-muted-foreground">
                {[
                  row.tx_date,
                  row.account_name || 'Unknown account',
                  `(${getCurrency(row)})`,
                  getCategoryName(row),
                ].join(' • ')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'self-center text-[0.8rem] font-bold tabular-nums whitespace-nowrap',
                  resolveAmountClass(row),
                )}
              >
                {formatTransactionAmount(row, viewMode)}
              </div>
              <Button
                type="button"
                size="sm"
                variant={expandedTransactionId === row.id ? 'secondary' : 'outline'}
                onClick={() =>
                  setExpandedTransactionId((currentId) => (currentId === row.id ? null : row.id))
                }
              >
                {expandedTransactionId === row.id ? 'Hide rule' : 'Categorize'}
              </Button>
            </div>
          </div>

          {expandedTransactionId === row.id ? (
            <TransactionCategorizationPanel
              transaction={row}
              categories={categorization.categories}
              categoriesLoading={categorization.categoriesLoading}
              creatingTransactionId={categorization.creatingTransactionId}
              status={categorization.status}
              onCreateRule={categorization.actions.createRule}
              onClose={() => setExpandedTransactionId(null)}
            />
          ) : null}
        </article>
      ))}
    </div>
  );
}
