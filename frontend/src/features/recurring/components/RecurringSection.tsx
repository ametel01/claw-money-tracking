import { recomputeRecurringSeries, toErrorMessage } from '@/api/expenses';
import { RecurringPreviewCard } from '@/components/RecurringPreviewCard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { RecurringInsights } from '@/types';
import { useState } from 'react';

interface RecurringSectionProps {
  insights: RecurringInsights | null;
  onInsightsReload: () => Promise<void>;
}

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

export function RecurringSection({ insights, onInsightsReload }: RecurringSectionProps) {
  const [status, setStatus] = useState<{ tone: StatusTone; message: string }>({
    tone: 'idle',
    message: '',
  });
  const [recomputing, setRecomputing] = useState(false);

  async function handleRecompute() {
    setRecomputing(true);
    setStatus({ tone: 'pending', message: 'Recomputing recurring series…' });

    try {
      const response = await recomputeRecurringSeries();
      await onInsightsReload();
      setStatus({
        tone: 'success',
        message: `Recomputed ${response.seriesCount} series from ${response.occurrenceCount} recurring occurrence(s).`,
      });
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={handleRecompute} disabled={recomputing}>
          {recomputing ? 'Recomputing…' : 'Recompute recurring'}
        </Button>
        <RecurringStatus status={status} />
      </div>
      <RecurringPreviewCard insights={insights} />
    </div>
  );
}

function RecurringStatus({
  status,
}: {
  status: {
    tone: StatusTone;
    message: string;
  };
}) {
  if (!status.message || status.tone === 'idle') {
    return null;
  }

  if (status.tone === 'error') {
    return (
      <Alert variant="destructive" className="py-2">
        <AlertDescription className="text-xs">{status.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <p
      className={
        status.tone === 'success' ? 'text-xs text-[var(--color-success)]' : 'text-xs text-muted-foreground'
      }
    >
      {status.message}
    </p>
  );
}
