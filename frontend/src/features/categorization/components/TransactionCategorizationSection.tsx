import { TransactionList } from '@/components/TransactionList';
import { Button } from '@/components/ui/button';
import type { CurrencyViewMode, TransactionRecord } from '@/types';
import { useState } from 'react';
import { TransactionCategorizationPanel } from './TransactionCategorizationPanel';
import { useTransactionCategorization } from '../hooks/useTransactionCategorization';

interface TransactionCategorizationSectionProps {
  transactions: TransactionRecord[];
  activeMonth: string | null;
  viewMode: CurrencyViewMode;
  onRuleCreated: () => Promise<void>;
}

export function TransactionCategorizationSection({
  transactions,
  activeMonth,
  viewMode,
  onRuleCreated,
}: TransactionCategorizationSectionProps) {
  const [expandedTransactionId, setExpandedTransactionId] = useState<number | null>(null);
  const categorization = useTransactionCategorization({ onRuleCreated });

  return (
    <TransactionList
      transactions={transactions}
      activeMonth={activeMonth}
      viewMode={viewMode}
      renderActions={(transaction) => (
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          variant={expandedTransactionId === transaction.id ? 'secondary' : 'outline'}
          onClick={() =>
            setExpandedTransactionId((currentId) =>
              currentId === transaction.id ? null : transaction.id,
            )
          }
        >
          {expandedTransactionId === transaction.id ? 'Hide rule' : 'Categorize'}
        </Button>
      )}
      renderExpandedContent={(transaction) =>
        expandedTransactionId === transaction.id ? (
          <TransactionCategorizationPanel
            transaction={transaction}
            categories={categorization.categories}
            categoriesLoading={categorization.categoriesLoading}
            creatingTransactionId={categorization.creatingTransactionId}
            status={categorization.status}
            onCreateRule={categorization.actions.createRule}
            onClose={() => setExpandedTransactionId(null)}
          />
        ) : null
      }
    />
  );
}
