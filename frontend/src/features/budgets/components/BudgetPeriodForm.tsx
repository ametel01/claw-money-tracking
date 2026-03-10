import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { monthLabel } from '@/lib/format';
import { type FormEvent, useEffect, useState } from 'react';

interface BudgetPeriodFormProps {
  activeMonth: string;
  pending: boolean;
  onCreate: (input: { budgetName: string; currency: string }) => Promise<void>;
}

export function BudgetPeriodForm({ activeMonth, pending, onCreate }: BudgetPeriodFormProps) {
  const [budgetName, setBudgetName] = useState(`${monthLabel(activeMonth)} Budget`);
  const [currency, setCurrency] = useState('PHP');

  useEffect(() => {
    setBudgetName(`${monthLabel(activeMonth)} Budget`);
    setCurrency('PHP');
  }, [activeMonth]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreate({
      budgetName,
      currency,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg border border-dashed p-3">
      <div className="grid gap-1.5">
        <p className="text-xs font-semibold text-foreground">
          No budget exists for {monthLabel(activeMonth)}.
        </p>
        <p className="text-xs text-muted-foreground">
          Create a budget period for this month before you add category targets.
        </p>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_120px]">
        <Input
          value={budgetName}
          onChange={(event) => setBudgetName(event.target.value)}
          placeholder="Monthly budget name"
          maxLength={80}
          required
        />
        <Input
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          placeholder="PHP"
          maxLength={3}
          required
        />
      </div>
      <Button type="submit" className="w-full sm:w-fit" disabled={pending}>
        {pending ? 'Creating…' : `Create ${monthLabel(activeMonth)} budget`}
      </Button>
    </form>
  );
}
