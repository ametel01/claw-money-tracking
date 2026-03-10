import {
  createCategorizationRuleFromTransaction,
  getCategories,
  toErrorMessage,
} from '@/api/expenses';
import type { CategoryRecord } from '@/types';
import { useCallback, useEffect, useState } from 'react';

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

interface CategorizationStatus {
  tone: StatusTone;
  message: string;
  transactionId: number | null;
}

interface UseTransactionCategorizationOptions {
  onRuleCreated: () => Promise<void>;
}

export function useTransactionCategorization({
  onRuleCreated,
}: UseTransactionCategorizationOptions) {
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [creatingTransactionId, setCreatingTransactionId] = useState<number | null>(null);
  const [status, setStatus] = useState<CategorizationStatus>({
    tone: 'idle',
    message: '',
    transactionId: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      setCategoriesLoading(true);

      try {
        const response = await getCategories();
        if (cancelled) {
          return;
        }

        setCategories(response);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus({
          tone: 'error',
          message: `Failed to load categories: ${toErrorMessage(error)}`,
          transactionId: null,
        });
      } finally {
        if (!cancelled) {
          setCategoriesLoading(false);
        }
      }
    }

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  const createRule = useCallback(
    async (input: {
      transactionId: number;
      categoryId: number;
      accountScoped: boolean;
      matchType: 'contains' | 'exact' | 'regex';
      pattern: string;
    }) => {
      setCreatingTransactionId(input.transactionId);
      setStatus({
        tone: 'pending',
        message: 'Creating categorization rule…',
        transactionId: input.transactionId,
      });

      try {
        await createCategorizationRuleFromTransaction(input);
        await onRuleCreated();
        setStatus({
          tone: 'success',
          message: 'Categorization rule created and transaction data refreshed.',
          transactionId: input.transactionId,
        });
      } catch (error) {
        setStatus({
          tone: 'error',
          message: toErrorMessage(error),
          transactionId: input.transactionId,
        });
      } finally {
        setCreatingTransactionId(null);
      }
    },
    [onRuleCreated],
  );

  return {
    categories,
    categoriesLoading,
    creatingTransactionId,
    status,
    actions: {
      createRule,
    },
  };
}
