import { backfillUsdPhp, toErrorMessage, updateUsdPhpRate } from '@/api/expenses';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { CurrencyViewMode } from '@/types';
import { type FormEvent, useState } from 'react';

interface CurrencyControlsProps {
  viewMode: CurrencyViewMode;
  onViewModeChange: (mode: CurrencyViewMode) => void;
  onRateUpdated: () => Promise<void>;
}

type Status = { tone: 'idle' | 'pending' | 'success' | 'error'; message: string };

export function CurrencyControls({
  viewMode,
  onViewModeChange,
  onRateUpdated,
}: CurrencyControlsProps) {
  const [fxStatus, setFxStatus] = useState<Status>({ tone: 'idle', message: '' });
  const [backfillPending, setBackfillPending] = useState(false);

  async function handleFxSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const rate = Number((form.elements.namedItem('usdPhpRate') as HTMLInputElement).value || 0);

    if (!Number.isFinite(rate) || rate <= 0) {
      setFxStatus({ tone: 'error', message: 'Enter a valid USD/PHP rate.' });
      return;
    }

    setFxStatus({ tone: 'pending', message: 'Saving FX rate…' });

    try {
      const response = await updateUsdPhpRate(rate);
      if (!response.ok) throw new Error(response.error || 'Failed to update FX rate');
      await onRateUpdated();
      setFxStatus({ tone: 'success', message: 'USD/PHP rate updated.' });
    } catch (error) {
      setFxStatus({ tone: 'error', message: toErrorMessage(error) });
    }
  }

  async function handleBackfill() {
    setBackfillPending(true);
    setFxStatus({ tone: 'pending', message: 'Backfilling historical FX…' });

    try {
      const response = await backfillUsdPhp();
      if (!response.ok) throw new Error(response.error || 'FX backfill failed');
      await onRateUpdated();
      setFxStatus({
        tone: 'success',
        message: `Backfilled FX for ${response.updated ?? 0} USD transaction(s).`,
      });
    } catch (error) {
      setFxStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setBackfillPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label
          htmlFor="viewMode"
          className="text-[0.64rem] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Transaction display
        </Label>
        <Select value={viewMode} onValueChange={(v) => onViewModeChange(v as CurrencyViewMode)}>
          <SelectTrigger id="viewMode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="home">PHP normalized</SelectItem>
            <SelectItem value="native">Native currency</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <form onSubmit={handleFxSubmit} className="flex flex-col gap-2.5">
        <div className="grid gap-1.5">
          <Label
            htmlFor="usdPhpRate"
            className="text-[0.64rem] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            USD to PHP
          </Label>
          <Input
            id="usdPhpRate"
            name="usdPhpRate"
            type="number"
            step="0.0001"
            placeholder="58.2000"
            required
          />
        </div>
        <Button type="submit" disabled={fxStatus.tone === 'pending'} className="w-full">
          {fxStatus.tone === 'pending' && !backfillPending ? 'Saving…' : 'Update USD/PHP'}
        </Button>
      </form>

      <Button
        type="button"
        variant="outline"
        disabled={backfillPending}
        onClick={handleBackfill}
        className="w-full"
      >
        {backfillPending ? 'Backfilling…' : 'Backfill historical USD/PHP'}
      </Button>

      <FxStatusLine status={fxStatus} />
    </div>
  );
}

function FxStatusLine({ status }: { status: Status }) {
  if (status.tone === 'idle' || !status.message) return <div className="min-h-[1.1rem]" />;

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
        status.tone === 'success'
          ? 'text-xs text-[var(--color-success)]'
          : 'text-xs text-muted-foreground'
      }
    >
      {status.message}
    </p>
  );
}
