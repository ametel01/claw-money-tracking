import { disableCategorizationRule, getCategorizationRules, toErrorMessage } from '@/api/expenses';
import type { CategorizationRuleRecord } from '@/types';
import { useCallback, useEffect, useState } from 'react';

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

interface RulesStatus {
  tone: StatusTone;
  message: string;
}

export function useCategorizationRules() {
  const [rules, setRules] = useState<CategorizationRuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRuleId, setBusyRuleId] = useState<number | null>(null);
  const [status, setStatus] = useState<RulesStatus>({ tone: 'idle', message: '' });

  const refreshRules = useCallback(async () => {
    setLoading(true);

    try {
      const response = await getCategorizationRules();
      setRules(response);
      setStatus((current) =>
        current.tone === 'error' ? { tone: 'success', message: 'Categorization rules refreshed.' } : current,
      );
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRules();
  }, [refreshRules]);

  const disableRule = useCallback(
    async (ruleId: number) => {
      setBusyRuleId(ruleId);
      setStatus({ tone: 'pending', message: 'Disabling categorization rule…' });

      try {
        await disableCategorizationRule(ruleId);
        await refreshRules();
        setStatus({ tone: 'success', message: 'Categorization rule disabled.' });
      } catch (error) {
        setStatus({ tone: 'error', message: toErrorMessage(error) });
      } finally {
        setBusyRuleId(null);
      }
    },
    [refreshRules],
  );

  return {
    rules,
    loading,
    busyRuleId,
    status,
    actions: {
      refreshRules,
      disableRule,
    },
  };
}
