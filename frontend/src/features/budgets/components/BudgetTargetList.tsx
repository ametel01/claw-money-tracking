import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format';
import type { BudgetPeriodRecord, BudgetTargetRecord } from '@/types';
import { type FormEvent, useEffect, useState } from 'react';

interface BudgetTargetListProps {
  period: BudgetPeriodRecord;
  pending: boolean;
  deletingTargetId: number | null;
  onUpdateTarget: (input: { categoryId: number; targetAmount: number }) => Promise<void>;
  onDeleteTarget: (targetId: number) => Promise<void>;
}

export function BudgetTargetList({
  period,
  pending,
  deletingTargetId,
  onUpdateTarget,
  onDeleteTarget,
}: BudgetTargetListProps) {
  if (period.targets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This budget period exists, but it does not have any category targets yet.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {period.targets.map((target) => (
        <BudgetTargetListItem
          key={target.id}
          currency={period.currency}
          target={target}
          pending={pending}
          deleting={deletingTargetId === target.id}
          onUpdateTarget={onUpdateTarget}
          onDeleteTarget={onDeleteTarget}
        />
      ))}
    </div>
  );
}

interface BudgetTargetListItemProps {
  currency: string;
  target: BudgetTargetRecord;
  pending: boolean;
  deleting: boolean;
  onUpdateTarget: (input: { categoryId: number; targetAmount: number }) => Promise<void>;
  onDeleteTarget: (targetId: number) => Promise<void>;
}

function BudgetTargetListItem({
  currency,
  target,
  pending,
  deleting,
  onUpdateTarget,
  onDeleteTarget,
}: BudgetTargetListItemProps) {
  const [amount, setAmount] = useState(String(target.targetAmount));

  useEffect(() => {
    setAmount(String(target.targetAmount));
  }, [target.targetAmount]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    await onUpdateTarget({
      categoryId: target.categoryId,
      targetAmount: parsedAmount,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded-lg border border-border/70 bg-muted/15 p-3 sm:grid-cols-[minmax(0,1fr)_160px] xl:grid-cols-[minmax(0,1fr)_160px_auto_auto]"
    >
      <div className="grid gap-1">
        <p className="text-xs font-semibold text-foreground">{target.categoryName}</p>
        <p className="text-xs text-muted-foreground">
          {formatMoney(target.actualAmount, currency)} actual •{' '}
          {target.remainingAmount < 0
            ? `${formatMoney(Math.abs(target.remainingAmount), currency)} over`
            : `${formatMoney(target.remainingAmount, currency)} remaining`}
        </p>
      </div>
      <Input
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        required
      />
      <Button type="submit" variant="outline" className="w-full xl:w-auto" disabled={pending || deleting}>
        {pending && !deleting ? 'Saving…' : 'Save'}
      </Button>
      <Button
        type="button"
        variant="destructive"
        className="w-full xl:w-auto"
        disabled={pending || deleting}
        onClick={() => void onDeleteTarget(target.id)}
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </Button>
    </form>
  );
}
