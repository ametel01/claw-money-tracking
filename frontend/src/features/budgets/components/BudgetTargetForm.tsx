import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CategoryRecord } from '@/types';
import { type FormEvent, useEffect, useState } from 'react';

interface BudgetTargetFormProps {
  categories: CategoryRecord[];
  pending: boolean;
  onAddTarget: (input: { categoryId: number; targetAmount: number }) => Promise<void>;
}

export function BudgetTargetForm({
  categories,
  pending,
  onAddTarget,
}: BudgetTargetFormProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(categories[0]?.id?.toString() ?? '');
  const [targetAmount, setTargetAmount] = useState('');

  useEffect(() => {
    setSelectedCategoryId(categories[0]?.id?.toString() ?? '');
  }, [categories]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedCategoryId = Number(selectedCategoryId);
    const parsedAmount = Number(targetAmount);

    if (!Number.isFinite(parsedCategoryId) || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    await onAddTarget({
      categoryId: parsedCategoryId,
      targetAmount: parsedAmount,
    });
    setTargetAmount('');
  }

  if (categories.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        All expense categories already have targets for this month.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg border border-border/70 p-3">
      <div className="grid gap-1">
        <p className="text-xs font-semibold text-foreground">Add category target</p>
        <p className="text-xs text-muted-foreground">
          Choose an expense category and set the target amount for the active budget period.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]">
        <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {categories.map((category) => (
                <SelectItem key={category.id} value={String(category.id)}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          placeholder="2500"
          value={targetAmount}
          onChange={(event) => setTargetAmount(event.target.value)}
          required
        />
        <Button type="submit" className="w-full md:w-fit" disabled={pending}>
          {pending ? 'Saving…' : 'Add target'}
        </Button>
      </div>
    </form>
  );
}
