import {
  createBudgetPeriod,
  deleteBudgetTarget,
  getCategories,
  toErrorMessage,
  upsertBudgetTarget,
} from '@/api/expenses';
import type { BudgetPeriodRecord, CategoryRecord } from '@/types';
import { useCallback, useEffect, useState } from 'react';

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

export interface BudgetEditorStatus {
  tone: StatusTone;
  message: string;
}

interface UseBudgetEditorOptions {
  activeMonth: string | null;
  period: BudgetPeriodRecord | null;
  onBudgetPeriodChanged: (period: BudgetPeriodRecord) => void;
}

export function useBudgetEditor({
  activeMonth,
  period,
  onBudgetPeriodChanged,
}: UseBudgetEditorOptions) {
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [status, setStatus] = useState<BudgetEditorStatus>({ tone: 'idle', message: '' });
  const [creatingPeriod, setCreatingPeriod] = useState(false);
  const [savingTarget, setSavingTarget] = useState(false);
  const [deletingTargetId, setDeletingTargetId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      setCategoriesLoading(true);

      try {
        const response = await getCategories();
        if (cancelled) {
          return;
        }

        setCategories(response.filter((category) => category.kind === 'expense'));
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus({
          tone: 'error',
          message: `Failed to load budget categories: ${toErrorMessage(error)}`,
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

  const createPeriod = useCallback(
    async (input: { budgetName: string; currency: string }) => {
      if (!activeMonth) {
        setStatus({ tone: 'error', message: 'Select a month before creating a budget period.' });
        return;
      }

      setCreatingPeriod(true);
      setStatus({ tone: 'pending', message: `Creating budget period for ${activeMonth}…` });

      try {
        const nextPeriod = await createBudgetPeriod({
          month: activeMonth,
          budgetName: input.budgetName.trim() || 'Default Budget',
          currency: input.currency.trim().toUpperCase() || 'PHP',
        });
        onBudgetPeriodChanged(nextPeriod);
        setStatus({ tone: 'success', message: 'Budget period created.' });
      } catch (error) {
        setStatus({ tone: 'error', message: toErrorMessage(error) });
      } finally {
        setCreatingPeriod(false);
      }
    },
    [activeMonth, onBudgetPeriodChanged],
  );

  const saveTarget = useCallback(
    async (input: { categoryId: number; targetAmount: number; successMessage: string }) => {
      if (!period) {
        setStatus({
          tone: 'error',
          message: 'Create a budget period before editing category targets.',
        });
        return;
      }

      setSavingTarget(true);
      setStatus({ tone: 'pending', message: 'Saving budget target…' });

      try {
        const nextPeriod = await upsertBudgetTarget({
          periodId: period.id,
          categoryId: input.categoryId,
          targetAmount: input.targetAmount,
        });
        onBudgetPeriodChanged(nextPeriod);
        setStatus({ tone: 'success', message: input.successMessage });
      } catch (error) {
        setStatus({ tone: 'error', message: toErrorMessage(error) });
      } finally {
        setSavingTarget(false);
      }
    },
    [onBudgetPeriodChanged, period],
  );

  const addTarget = useCallback(
    async (input: { categoryId: number; targetAmount: number }) => {
      await saveTarget({
        ...input,
        successMessage: 'Budget target added.',
      });
    },
    [saveTarget],
  );

  const updateTarget = useCallback(
    async (input: { categoryId: number; targetAmount: number }) => {
      await saveTarget({
        ...input,
        successMessage: 'Budget target updated.',
      });
    },
    [saveTarget],
  );

  const removeTarget = useCallback(
    async (targetId: number) => {
      setDeletingTargetId(targetId);
      setStatus({ tone: 'pending', message: 'Deleting budget target…' });

      try {
        const nextPeriod = await deleteBudgetTarget(targetId);
        onBudgetPeriodChanged(nextPeriod);
        setStatus({ tone: 'success', message: 'Budget target deleted.' });
      } catch (error) {
        setStatus({ tone: 'error', message: toErrorMessage(error) });
      } finally {
        setDeletingTargetId(null);
      }
    },
    [onBudgetPeriodChanged],
  );

  return {
    categories,
    categoriesLoading,
    creatingPeriod,
    savingTarget,
    deletingTargetId,
    status,
    actions: {
      createPeriod,
      addTarget,
      updateTarget,
      removeTarget,
    },
  };
}
