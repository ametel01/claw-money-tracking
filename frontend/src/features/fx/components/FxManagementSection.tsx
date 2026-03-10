import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { formatMoney } from '@/lib/format';
import { type FormEvent, useState } from 'react';
import { useFxManagement } from '../hooks/useFxManagement';

interface FxManagementSectionProps {
  onFxUpdated: () => Promise<void>;
}

export function FxManagementSection({ onFxUpdated }: FxManagementSectionProps) {
  const fxManagement = useFxManagement({ onFxUpdated });
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [quoteCurrency, setQuoteCurrency] = useState('PHP');
  const [rate, setRate] = useState('');
  const [rateDate, setRateDate] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedRate = Number(rate);

    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      return;
    }

    await fxManagement.actions.saveRate({
      base: baseCurrency.trim().toUpperCase(),
      quote: quoteCurrency.trim().toUpperCase(),
      rate: parsedRate,
      ...(rateDate ? { date: rateDate } : {}),
    });
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg border border-border/70 p-3">
        <div className="grid gap-1">
          <p className="text-xs font-semibold text-foreground">Manual FX entry</p>
          <p className="text-xs text-muted-foreground">
            Save dated FX rates for any supported currency pair exposed by the backend.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-[100px_100px_minmax(0,1fr)_180px_auto]">
          <Input
            value={baseCurrency}
            onChange={(event) => setBaseCurrency(event.target.value.toUpperCase())}
            maxLength={3}
            placeholder="USD"
            required
          />
          <Input
            value={quoteCurrency}
            onChange={(event) => setQuoteCurrency(event.target.value.toUpperCase())}
            maxLength={3}
            placeholder="PHP"
            required
          />
          <Input
            type="number"
            min="0.000001"
            step="0.0001"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            placeholder="58.2000"
            required
          />
          <Input
            type="date"
            value={rateDate}
            onChange={(event) => setRateDate(event.target.value)}
          />
          <Button type="submit" disabled={fxManagement.savingRate}>
            {fxManagement.savingRate ? 'Saving…' : 'Save rate'}
          </Button>
        </div>
      </form>

      <Button
        type="button"
        variant="outline"
        className="w-full md:w-fit"
        disabled={fxManagement.backfilling}
        onClick={() => void fxManagement.actions.backfill()}
      >
        {fxManagement.backfilling ? 'Backfilling…' : 'Backfill historical USD/PHP'}
      </Button>

      <FxStatus status={fxManagement.status} />

      <Separator />

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-foreground">FX history</p>
          <Badge variant="outline">{fxManagement.rates.length} record(s)</Badge>
        </div>

        {fxManagement.loadingRates ? (
          <p className="text-xs text-muted-foreground">Loading FX history…</p>
        ) : fxManagement.rates.length === 0 ? (
          <p className="text-xs text-muted-foreground">No FX rates have been saved yet.</p>
        ) : (
          fxManagement.rates.map((rateRecord) => (
            <article
              key={`${rateRecord.base_currency}-${rateRecord.quote_currency}-${rateRecord.rate_date}`}
              className="grid gap-2 rounded-lg border border-border/70 bg-muted/15 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {rateRecord.base_currency}/{rateRecord.quote_currency}
                </Badge>
                <Badge variant="outline">{rateRecord.provider}</Badge>
                <Badge variant="outline">{rateRecord.rate_date}</Badge>
              </div>
              <p className="text-xs text-foreground">
                1 {rateRecord.base_currency} = {formatMoney(rateRecord.rate, rateRecord.quote_currency)}
              </p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function FxStatus({
  status,
}: {
  status: {
    tone: 'idle' | 'pending' | 'success' | 'error';
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
