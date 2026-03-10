import { backfillUsdPhp, getFxRates, toErrorMessage, upsertFxRate } from '@/api/expenses';
import type { FxRateRecord } from '@/types';
import { useCallback, useEffect, useState } from 'react';

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

interface FxStatus {
  tone: StatusTone;
  message: string;
}

interface UseFxManagementOptions {
  onFxUpdated: () => Promise<void>;
}

export function useFxManagement({ onFxUpdated }: UseFxManagementOptions) {
  const [rates, setRates] = useState<FxRateRecord[]>([]);
  const [loadingRates, setLoadingRates] = useState(true);
  const [savingRate, setSavingRate] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [status, setStatus] = useState<FxStatus>({ tone: 'idle', message: '' });

  const refreshRates = useCallback(async () => {
    setLoadingRates(true);

    try {
      const response = await getFxRates();
      setRates(response);
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setLoadingRates(false);
    }
  }, []);

  useEffect(() => {
    void refreshRates();
  }, [refreshRates]);

  const saveRate = useCallback(
    async (input: { base: string; quote: string; rate: number; date?: string }) => {
      setSavingRate(true);
      setStatus({ tone: 'pending', message: 'Saving FX rate…' });

      try {
        await upsertFxRate(input);
        await Promise.all([refreshRates(), onFxUpdated()]);
        setStatus({
          tone: 'success',
          message: `${input.base}/${input.quote} rate saved.`,
        });
      } catch (error) {
        setStatus({ tone: 'error', message: toErrorMessage(error) });
      } finally {
        setSavingRate(false);
      }
    },
    [onFxUpdated, refreshRates],
  );

  const backfill = useCallback(async () => {
    setBackfilling(true);
    setStatus({ tone: 'pending', message: 'Backfilling historical FX…' });

    try {
      const response = await backfillUsdPhp();
      if (!response.ok) {
        throw new Error(response.error || 'FX backfill failed');
      }

      await onFxUpdated();
      setStatus({
        tone: 'success',
        message: `Backfilled FX for ${response.updated ?? 0} USD transaction(s).`,
      });
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setBackfilling(false);
    }
  }, [onFxUpdated]);

  return {
    rates,
    loadingRates,
    savingRate,
    backfilling,
    status,
    actions: {
      saveRate,
      backfill,
      refreshRates,
    },
  };
}
